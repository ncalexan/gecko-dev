/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.gecko.db;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.text.TextUtils;

import org.mozilla.gecko.GeckoAppShell;

import static org.mozilla.gecko.db.BrowserContract.DeletedLogins;
import static org.mozilla.gecko.db.BrowserContract.Logins;
import static org.mozilla.gecko.db.BrowserContract.LoginsDisabledHosts;

public class LocalLoginsAccessor implements LoginsAccessor {
    private static final String LOGTAG = "GeckoLoginsAccessor";

    private final Uri loginsUriWithProfile;
    private final Uri deletedLoginsUriWithProfile;
    private final Uri disabledHostsUriWithProfile;

    public LocalLoginsAccessor(String profileName) {
        loginsUriWithProfile = DBUtils.appendProfileWithDefault(profileName, Logins.CONTENT_URI);
        deletedLoginsUriWithProfile = DBUtils.appendProfileWithDefault(profileName, DeletedLogins.CONTENT_URI);
        disabledHostsUriWithProfile = DBUtils.appendProfileWithDefault(profileName, LoginsDisabledHosts.CONTENT_URI);
    }

    private Context getContext() {
        final Context context = GeckoAppShell.getApplicationContext();
        return context;
        // final BrowserDB db = BrowserDB.from(context);
    }

    @Override
    public void addLogin(ContentValues values) {
        getContext().getContentResolver().insert(loginsUriWithProfile, values);
    }

    @Override
    public void removeLogin(long id) {
        getContext().getContentResolver().delete(loginsUriWithProfile.buildUpon().appendPath(String.valueOf(id)).build(), null, null);
    }

    @Override
    public void modifyLogin(long id, ContentValues values) {
        getContext().getContentResolver().update(loginsUriWithProfile.buildUpon().appendPath(String.valueOf(id)).build(), values, null, null);
    }

    @Override
    public void removeAllLogins() {
        getContext().getContentResolver().delete(loginsUriWithProfile, null, null);
        getContext().getContentResolver().delete(deletedLoginsUriWithProfile, null, null);
    }

    @Override
    public int countLogins() {
        Cursor cursor = getContext().getContentResolver().query(loginsUriWithProfile, null, null, null, null);
        try {
            return cursor == null ? 0 : cursor.getCount();
        } finally {
            cursor.close();
        }
    }

    @Override
    public Cursor searchLogins(String selection, String[] selectionArgs) {
        final Cursor cursor = getContext().getContentResolver().query(loginsUriWithProfile, null, selection, selectionArgs, null);
        return cursor;
    }

    @Override
    public Cursor getAllDisabledHosts() {
        final Cursor cursor = getContext().getContentResolver().query(disabledHostsUriWithProfile, null, null, null, null);
        return cursor;
    }

    @Override
    public Cursor getLoginsSavedEnabled(String hostname) {
        final Uri uri = disabledHostsUriWithProfile.buildUpon().appendQueryParameter(BrowserContract.PARAM_LIMIT, "1").build();
        boolean isHostnameEmpty = TextUtils.isEmpty(hostname);
        return getContext()
                .getContentResolver()
                .query(uri,
                       null,
                       isHostnameEmpty ? null : LoginsDisabledHosts.HOSTNAME + "= ?",
                       isHostnameEmpty ? null : new String[] {hostname},
                       null);
    }

    @Override
    public void setLoginSavingEnabled(String hostname, boolean isEnabled) {
        if (isEnabled) {
            getContext().getContentResolver().delete(disabledHostsUriWithProfile, LoginsDisabledHosts.HOSTNAME + "=?", new String[]{hostname});
        } else {
            final ContentValues values = new ContentValues();
            values.put(LoginsDisabledHosts.HOSTNAME, hostname);
            getContext().getContentResolver().insert(disabledHostsUriWithProfile, values);
        }
    }
}
