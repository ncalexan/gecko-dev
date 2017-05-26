/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.gecko.db;

import org.mozilla.gecko.annotation.JNITarget;

import android.content.ContentValues;
import android.database.Cursor;

/**
 * Interface for interactions with {@link LoginsProvider} that is accessed from
 * {@link nsILoginManagerStorage.idl} implementation through JNI.
 *
 * Nota bene: The concrete implementor of this interface does not validate the parameters and the parameters are passed
 * to {@link android.content.ContentProvider} as it is. It is the responsibility of the caller to validate
 * the arguments.
 */

@JNITarget
public interface LoginsAccessor {
    /**
     * Store a new login entry from the content values after deleting the entry from deletedLogins table if needed.
     *
     * @param values The ContentValues to use.
     */
    void addLogin(ContentValues values);

    /**
     * Remove the login from logins table and store it as a deletedLogins.
     *
     * @param id login id to delete.
     */
    void removeLogin(long id);

    /**
     * Update the login from content values.
     *
     * @param id login id to update.
     * @param values The ContentValues to use.
     */
    void modifyLogin(long id, ContentValues values);

    // Wipe all stored logins and deletedLogins.
    void removeAllLogins();

    // Count the number of all stored logins.
    int countLogins();

    /**
     * Search for logins based on selection condition.
     * The resultant cursor has all columns for {@link org.mozilla.gecko.db.BrowserContract.Logins} selected.
     *
     * @param selection The SQL selection where clause.
     * @param selectionArgs The conditional values to substitute in place of format parameters.
     * @return A cursor representing the contents of the logins table filtered according to the arguments.
     * Can return <code>null</code>.
     */
    Cursor searchLogins(String selection, String[] selectionArgs);

    /**
     * Query for hostname of all disabled hosts.
     *
     * @return A cursor representing the contents of the disabledHosts table.
     * Can return <code>null</code>.
     */
    Cursor getAllDisabledHosts();

    /**
     * Check if hostname has entry in disabledHosts table.
     *
     * @param hostname The hostname for querying. <code>null</code> will return all the rows.
     * @return A cursor representing the contents of the disabledHosts table.
     * Can return <code>null</code>.
     */
    Cursor getLoginsSavedEnabled(String hostname);

    /**
     * Store/remove hostname from disabledHosts table based on boolean parameter. The login saving is
     * dependent on hostname not present in disabledHosts table.
     *
     * @param hostname The hostname to store/remove from disabledHosts table
     * @param isEnabled The hostname is removed from disabledHosts table if true and stored if false.
     */
    void setLoginSavingEnabled(String hostname, boolean isEnabled);
}
