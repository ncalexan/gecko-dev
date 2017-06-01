use std::marker::PhantomData;

use primitives::{ConsumedResult, Error, Info, ParseError, Parser, RangeStream};
use primitives::FastResult::*;

pub struct Range<I>(I::Range) where I: RangeStream;

impl<I> Parser for Range<I>
    where I: RangeStream,
          I::Range: PartialEq + ::primitives::Range
{
    type Input = I;
    type Output = I::Range;

    #[inline]
    fn parse_lazy(&mut self, mut input: Self::Input) -> ConsumedResult<Self::Output, Self::Input> {
        use primitives::Range;
        let position = input.position();
        match input.uncons_range(self.0.len()) {
            Ok(other) => {
                if other == self.0 {
                    ConsumedOk((other, input))
                } else {
                    EmptyErr(ParseError::empty(position))
                }
            }
            Err(err) => EmptyErr(ParseError::new(position, err)),
        }
    }
    fn add_error(&mut self, errors: &mut ParseError<Self::Input>) {
        // TODO Add unexpected message?
        errors.add_error(Error::Expected(Info::Range(self.0.clone())));
    }
}

/// Zero-copy parser which reads a range of length `i.len()` and succeds if `i` is equal to that
/// range.
///
/// ```
/// # extern crate combine;
/// # use combine::range::range;
/// # use combine::*;
/// # fn main() {
/// let mut parser = range("hello");
/// let result = parser.parse("hello world");
/// assert_eq!(result, Ok(("hello", " world")));
/// let result = parser.parse("hel world");
/// assert!(result.is_err());
/// # }
/// ```
#[inline(always)]
pub fn range<I>(i: I::Range) -> Range<I>
    where I: RangeStream,
          I::Range: PartialEq + ::primitives::Range
{
    Range(i)
}

pub struct Take<I>(usize, PhantomData<fn(I) -> I>);
impl<I> Parser for Take<I>
    where I: RangeStream,
          I::Range: ::primitives::Range
{
    type Input = I;
    type Output = I::Range;

    #[inline]
    fn parse_lazy(&mut self, mut input: Self::Input) -> ConsumedResult<Self::Output, Self::Input> {
        let position = input.position();
        match input.uncons_range(self.0) {
            Ok(x) => ConsumedOk((x, input)),
            Err(err) => EmptyErr(ParseError::new(position, err)),
        }
    }
}

/// Zero-copy parser which reads a range of length `n`.
///
/// ```
/// # extern crate combine;
/// # use combine::range::take;
/// # use combine::*;
/// # fn main() {
/// let mut parser = take(1);
/// let result = parser.parse("1");
/// assert_eq!(result, Ok(("1", "")));
/// let mut parser = take(4);
/// let result = parser.parse("123abc");
/// assert_eq!(result, Ok(("123a", "bc")));
/// let result = parser.parse("abc");
/// assert!(result.is_err());
/// # }
/// ```
#[inline(always)]
pub fn take<I>(n: usize) -> Take<I>
    where I: RangeStream,
          I::Range: ::primitives::Range
{
    Take(n, PhantomData)
}

pub struct TakeWhile<I, F>(F, PhantomData<fn(I) -> I>);
impl<I, F> Parser for TakeWhile<I, F>
    where I: RangeStream,
          I::Range: ::primitives::Range,
          F: FnMut(I::Item) -> bool
{
    type Input = I;
    type Output = I::Range;

    #[inline]
    fn parse_lazy(&mut self, input: Self::Input) -> ConsumedResult<Self::Output, Self::Input> {
        ::primitives::uncons_while(input, &mut self.0)
    }
}

/// Zero-copy parser which reads a range of 0 or more tokens which satisfy `f`.
///
/// ```
/// # extern crate combine;
/// # use combine::range::take_while;
/// # use combine::*;
/// # fn main() {
/// let mut parser = take_while(|c: char| c.is_digit(10));
/// let result = parser.parse("123abc");
/// assert_eq!(result, Ok(("123", "abc")));
/// let result = parser.parse("abc");
/// assert_eq!(result, Ok(("", "abc")));
/// # }
/// ```
#[inline(always)]
pub fn take_while<I, F>(f: F) -> TakeWhile<I, F>
    where I: RangeStream,
          F: FnMut(I::Item) -> bool
{
    TakeWhile(f, PhantomData)
}

pub struct TakeWhile1<I, F>(F, PhantomData<fn(I) -> I>);
impl<I, F> Parser for TakeWhile1<I, F>
    where I: RangeStream,
          I::Range: ::primitives::Range,
          F: FnMut(I::Item) -> bool
{
    type Input = I;
    type Output = I::Range;

    #[inline]
    fn parse_lazy(&mut self, input: Self::Input) -> ConsumedResult<Self::Output, Self::Input> {
        match ::primitives::uncons_while(input, &mut self.0) {
            ConsumedOk((v, input)) => ConsumedOk((v, input)),
            EmptyOk((_, input)) => {
                let position = input.position();
                EmptyErr(ParseError::empty(position))
            }
            EmptyErr(err) => EmptyErr(err),
            ConsumedErr(err) => ConsumedErr(err),
        }
    }
}

/// Zero-copy parser which reads a range of 1 or more tokens which satisfy `f`.
///
/// ```
/// # extern crate combine;
/// # use combine::range::take_while1;
/// # use combine::*;
/// # fn main() {
/// let mut parser = take_while1(|c: char| c.is_digit(10));
/// let result = parser.parse("123abc");
/// assert_eq!(result, Ok(("123", "abc")));
/// let result = parser.parse("abc");
/// assert!(result.is_err());
/// # }
/// ```
#[inline(always)]
pub fn take_while1<I, F>(f: F) -> TakeWhile1<I, F>
    where I: RangeStream,
          I::Range: ::primitives::Range,
          F: FnMut(I::Item) -> bool
{
    TakeWhile1(f, PhantomData)
}

#[cfg(test)]
mod tests {
    use super::*;
    use primitives::Parser;

    #[test]
    fn take_while_test() {
        let result = take_while(|c: char| c.is_digit(10)).parse("123abc");
        assert_eq!(result, Ok(("123", "abc")));
        let result = take_while(|c: char| c.is_digit(10)).parse("abc");
        assert_eq!(result, Ok(("", "abc")));
    }

    #[test]
    fn take_while1_test() {
        let result = take_while1(|c: char| c.is_digit(10)).parse("123abc");
        assert_eq!(result, Ok(("123", "abc")));
        let result = take_while1(|c: char| c.is_digit(10)).parse("abc");
        assert!(result.is_err());
    }

    #[test]
    fn range_string_no_char_boundary_error() {
        let mut parser = range("hello");
        let result = parser.parse("hell\u{00EE} world");
        assert!(result.is_err());
    }
}
