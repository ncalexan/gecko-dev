use errors::*;

use descriptors::Desc;

use objects::{JObject, JClass, JThrowable, JValue};

use strings::JNIString;

use JNIEnv;

impl<'a, C, M> Desc<'a, JThrowable<'a>> for (C, M)
    where C: Desc<'a, JClass<'a>>,
          M: Into<JNIString>
{
    fn lookup(self, env: &JNIEnv<'a>) -> Result<JThrowable<'a>> {
        let jmsg: JObject = env.new_string(self.1)?.into();
        let obj: JThrowable =
            env.new_object(self.0, "(Ljava/lang/String;)V", &[JValue::from(jmsg)])?.into();
        Ok(obj)
    }
}

impl<'a> Desc<'a, JThrowable<'a>> for Exception {
    fn lookup(self, env: &JNIEnv<'a>) -> Result<JThrowable<'a>> {
        (self.class, self.msg).lookup(env)
    }
}
