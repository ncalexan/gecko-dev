#!/usr/bin/env python
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import with_statement, print_function

import argparse
import copy
import json
import os
import sys
import tempfile

# sys.path.insert(0, os.path.abspath(os.path.realpath(os.path.dirname(__file__))))

import manifestparser
import mozinfo

from mozdevice import devicemanager, devicemanagerADB, devicemanagerSUT
from mozlog import structured
from mozlog.structured import commandline


class InstrumentationTestRunner(object):
    def run_one_test(self, test):
        test_id = test['relpath']

        self.log.test_start(test_id)
        if 'disabled' in test:
            self.log.test_end(test_id, 'SKIP')
            return

        self.log.test_status(test_id, 'inner 1a', status='PASS', expected='PASS')
        self.log.test_status(test_id, 'inner 1b', status='PASS', expected='PASS')

        if 'F' in test_id:
            self.log.test_status(test_id, 'inner 2', status='FAIL', expected='PASS')

        if 'C' in test_id:
            self.log.test_status(test_id, 'inner 3', status='ERROR', expected='PASS')

        self.log.test_end(test_id, 'OK')

    def run_tests(self, tests):
        self.log = structured.structuredlog.get_default_logger()
        self.log.suite_start(tests)

        pass_count = 0
        fail_count = 0
        for test in tests:
            single_result = self.run_one_test(test)
            if single_result:
                pass_count += 1
            else:
                fail_count += 1

        self.log.suite_end()

        # Mozharness-parseable summary formatting.
        self.log.info('Result summary:')
        self.log.info('XXX INFO | Passed: %d' % pass_count)
        self.log.info('XXX INFO | Failed: %d' % fail_count)
        return fail_count == 0

def create_parser():
    parser = argparse.ArgumentParser('instrumentation',
                                     description='Runner for Android instrumentation tests.')

    parser.add_argument('manifest',
                        metavar='MANIFEST',
                        help='Instrumentation test manifest.')

    parser.add_argument('--suite', dest='subsuite', # XXX should be --subsuite.
                        default=None,
                        help='Subsuite to run.')

    parser.add_argument('--device-ip',
                        default=None,
                        help='Connect to device with given IP via SUT. (default: connect via ADB)')

    commandline.add_logging_group(parser)
    return parser

def get_device_manager(device_ip):
    if not device_ip:
        return devicemanagerADB.DeviceManagerADB()
    else:
        if ':' in device_ip:
            device_ip, port = args.device_port.split(':')
        else:
            port = 20701
        return devicemanagerSUT.DeviceManagerSUT(device_ip, device_port)


def resolve_tests_from_manifest(manifest, info=None, subsuite=None, names=None):
    """Some test suites differ from the standard (xpcshell, Mochitest, etc) test
suites in that the test sources themselves are compiled and not present in the
test package.  Such tests cannot be resolved by the standard mechanism, but
instead are resolved from a particular manifest and optionally filtered by
name."""

    mp = manifestparser.TestManifest(strict=False)
    mp.read(manifest)

    if not info:
        info = {}
    options = argparse.Namespace(subsuite=subsuite) if subsuite else None
    active_tests = mp.active_tests(exists=False, options=options, **info)

    return active_tests

def main(argv):
    parser = create_parser()
    args = parser.parse_args(argv)

    # parser = CPPUnittestOptions()
    # structured.commandline.add_logging_group(parser)
    # options, args = parser.parse_args()
    # if not args:
    #     print >>sys.stderr, '''Usage: %s <test binary> [<test binary>...]''' % sys.argv[0]
    #     sys.exit(1)
    # if not options.xre_path:
    #     print >>sys.stderr, '''Error: --xre-path is required'''
    #     sys.exit(1)

    log = structured.commandline.setup_logging('instrumentation',
                                               args,
                                               {'tbpl': sys.stdout})
    log.info('called with argv: {argv}'.format(argv=argv));
    log.info('called with cwd: {cwd}'.format(cwd=os.getcwd()));

    # for root, dirs, files in os.walk('.'):
    for f in sorted(os.listdir('.')):
        log.info('{f}'.format(f=f))

    # if not args.device_ip:
    #     dm._checkCmd(['install', '-r', ''])
    # log.info(os.getcwd())
    # dm.installApp(


    # enabled_tests, disabled_tests = resolve_tests_from_manifest(args.manifest, info=mozinfo.info)
    info = copy.deepcopy(mozinfo.info)
    # info['subsuite'] = 'browser'
    tests = resolve_tests_from_manifest(args.manifest, subsuite=args.subsuite, info=info)
    for test in tests:
        log.info('test: {test}'.format(test=json.dumps(test, indent=2)))

    tester = InstrumentationTestRunner()
    try:
        success = tester.run_tests(tests)
    except Exception as e:
        log.error(str(e))
        success = False

    apks = set()
    for test in tests:
        apks.add(test['instrumentation-apk'])
    apks = list(sorted(apks))

    for apk in apks:
        log.info('apk: {apk}'.format(apk=apk))

    dm = get_device_manager(args.device_ip)

    def install_apk(apk):
        log.info("Installing {apk}.".format(apk=apk))
        if not args.device_ip:
            print(dm._checkCmd(['install', '-r', apk]))
        else:
            remoteApk = os.path.join(dm.deviceRoot, os.path.basename(apk))
            try:
                log.info("Deleting {remoteApk}.".format(remoteApk=remoteApk))
                log.info(dm.removeFile(remoteApk))
                log.info("Pushing {apk} to {remoteApk}.".format(apk=apk, remoteApk=remoteApk))
                log.info(dm.pushFile(apk, remoteApk))
                log.info("Installing {remoteApk}.".format(remoteApk=remoteApk))
                log.info(dm.installApp(remoteApk))
            finally:
                try:
                    dm.removeFile(remoteApk)
                except:
                    pass # Swallow any problem cleaning up after ourselves.

    for apk in apks:
        install_apk(apk)

    # print(len(tests))
    # print(tests[0])


    return 0 if success else 1

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
