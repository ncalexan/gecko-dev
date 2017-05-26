/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;
const DB_VERSION = 5; // The database schema version

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Promise.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm")
Components.utils.import("resource://gre/modules/JNI.jsm");
Components.utils.import("resource://services-common/async.js");

XPCOMUtils.defineLazyModuleGetter(this, "LoginHelper",
                                  "resource://gre/modules/LoginHelper.jsm");


function LoginManagerStorage_fennecStorage() { };

LoginManagerStorage_fennecStorage.prototype = {

  classID : Components.ID("{4859e221-74ca-48d2-9ad2-05248f3ec745}"),
  QueryInterface : XPCOMUtils.generateQI([Ci.nsILoginManagerStorage,
                                          Ci.nsIInterfaceRequestor]),


  __uuidService: null,
  get _uuidService() {
    if (!this.__uuidService) {
      this.__uuidService = Cc["@mozilla.org/uuid-generator;1"].
                           getService(Ci.nsIUUIDGenerator);
    }
    return this.__uuidService;
  },


  // Common Java Class signatures.
  _SIG: {
    ContentValues: 'Landroid/content/ContentValues;',
    Cursor: 'Landroid/database/Cursor;',
    GeckoAppShell: 'Lorg/mozilla/gecko/GeckoAppShell;',
    LoginsAccessor: 'Lorg/mozilla/gecko/db/LoginsAccessor;',
    String: 'Ljava/lang/String;',
    NULL: new ctypes.voidptr_t(null)
  },


  /*
   * initialize
   *
   * Database initialization are done in Android, so return immediately.
   */
  initialize : function () {
    return Promise.resolve();
  },


  /*
   * terminate
   *
   * Internal method used by regression tests only.  It is called before
   * replacing this storage module with a new instance.
   */
  terminate : function () {
    return Promise.resolve();
  },


  /*
   * addLogin
   *
   */
  addLogin : function (login) {
    // Throws if there are bogus values.
    LoginHelper.checkLoginValues(login);

    // Clone the login, so we don't modify the caller's object.
    let loginClone = login.clone();

    // Initialize the nsILoginMetaInfo fields, unless the caller gave us values
    loginClone.QueryInterface(Ci.nsILoginMetaInfo);
    if (loginClone.guid && !this._isGuidUnique(loginClone.guid)) {
      throw new Error("specified GUID already exists");
    } else {
      loginClone.guid = this._uuidService.generateUUID().toString();
    }

    // Set timestamps
    let currentTime = Date.now();
    if (!loginClone.timeCreated) {
      loginClone.timeCreated = currentTime;
    }
    if (!loginClone.timeLastUsed) {
      loginClone.timeLastUsed = currentTime;
    }
    if (!loginClone.timePasswordChanged) {
      loginClone.timePasswordChanged = currentTime;
    }
    if (!loginClone.timesUsed) {
      loginClone.timesUsed = 1;
    }

    this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;
      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        // Allocate a local reference frame with enough space (13 for the names and 13 for the values).
        my_jenv.contents.contents.PushLocalFrame(my_jenv, 26);

        let values = this._populateContentValues(my_jenv, loginClone);
        loginsAccessor.addLogin(values);

        // Pop local reference frame to clear all the local references.
        my_jenv.contents.contents.PopLocalFrame(my_jenv, null);

        // Send a notification that a login was added.
        this._sendNotification("addLogin", loginClone);
        resolve(null);
      } catch (ex) {
        this.log("addLogin JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * removeLogin
   *
   */
  removeLogin : function (login) {
    let [idToDelete, storedLogin] = this._getIdForLogin(login);
    if (!idToDelete) {
      throw new Error("No matching logins");
    }

    this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;
      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        loginsAccessor.removeLogin(idToDelete);

        // Send a notification that a login was removed.
        this._sendNotification("removeLogin", storedLogin);
        resolve(null);
      } catch (ex) {
        this.log("removeLogin JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * modifyLogin
   *
   */
  modifyLogin : function (oldLogin, newLoginData) {
    let [idToModify, oldStoredLogin] = this._getIdForLogin(oldLogin);
    if (!idToModify) {
      throw new Error("No matching logins");
    }

    let newLogin = LoginHelper.buildModifiedLogin(oldStoredLogin, newLoginData);

    // Check if the new GUID is duplicate.
    if (newLogin.guid != oldStoredLogin.guid &&
        !this._isGuidUnique(newLogin.guid)) {
      throw new Error("specified GUID already exists");
    }

    // Look for an existing entry in case key properties changed.
    if (!newLogin.matches(oldLogin, true)) {
      let logins = this.findLogins({}, newLogin.hostname,
                                   newLogin.formSubmitURL,
                                   newLogin.httpRealm);

      if (logins.some(login => newLogin.matches(login, true))) {
        throw new Error("This login already exists.");
      }
    }

    this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;

      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        // Allocate a local reference frame with enough space (13 for the names and 13 for the values).
        my_jenv.contents.contents.PushLocalFrame(my_jenv, 26);

        let values = this._populateContentValues(my_jenv, newLogin);
        loginsAccessor.modifyLogin(idToModify, values);

        // Pop local reference frame to clear all the local references.
        my_jenv.contents.contents.PopLocalFrame(my_jenv, null);

        // Send a notification that a login was modified.
        this._sendNotification("modifyLogin", [oldStoredLogin, newLogin]);
        resolve(null);
      } catch (ex) {
        this.log("modifyLogin JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * getAllLogins
   *
   * Returns an array of nsILoginInfo.
   */
  getAllLogins : function (count) {
    let [logins, ids] = this._searchLogins({});
    this.log("_getAllLogins: returning " + logins.length + " logins.");
    if (count) {
      count.value = logins.length; // needed for XPCOM
    }
    return logins;
  },


  /*
   * searchLogins
   *
   * Public wrapper around _searchLogins to convert the nsIPropertyBag to a
   * JavaScript object and decrypt the results.
   *
   * Returns an array of decrypted nsILoginInfo.
   */
  searchLogins : function(count, matchData) {
    let realMatchData = {};
    // Convert nsIPropertyBag to normal JS object
    let propEnum = matchData.enumerator;
    while (propEnum.hasMoreElements()) {
      let prop = propEnum.getNext().QueryInterface(Ci.nsIProperty);
      realMatchData[prop.name] = prop.value;
    }

    let [logins, ids] = this._searchLogins(realMatchData);
    count.value = logins.length; // needed for XPCOM
    return logins;
  },


  /*
   * removeAllLogins
   *
   * Removes all logins from storage.
   */
  removeAllLogins : function () {
    this.log("Removing all logins");

    // Disabled hosts kept, as one presumably doesn't want to erase those.
    // TODO: Add these items to the deleted items table once we've sorted
    //       out the issues from bug 756701
    this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;

      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        loginsAccessor.removeAllLogins();
        this._sendNotification("removeAllLogins", null);
        resolve(null);
      } catch (ex) {
        this.log("removeAllLogins JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * getAllDisabledHosts
   *
   */
  getAllDisabledHosts : function (count) {
    let disabledHosts = this._queryDisabledHosts(null);

    this.log("_getAllDisabledHosts: returning " + disabledHosts.length + " disabled hosts.");
    if (count) {
      count.value = disabledHosts.length; // needed for XPCOM
    }
    return disabledHosts;
  },


  /*
   * getLoginSavingEnabled
   *
   */
  getLoginSavingEnabled : function (hostname) {
    this.log("Getting login saving is enabled for " + hostname);
    return this._queryDisabledHosts(hostname).length == 0
  },


  /*
   * setLoginSavingEnabled
   *
   */
  setLoginSavingEnabled : function (hostname, enabled) {
    // Throws if there are bogus values.
    LoginHelper.checkHostnameValue(hostname);
    this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;
      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        // Allocate a local reference frame with enough space (1 String read).
        my_jenv.contents.contents.PushLocalFrame(my_jenv, 1);

        var jHostName = JNI.NewString(my_jenv, hostname);
        loginsAccessor.setLoginSavingEnabled(jHostName, enabled);

        // Pop local reference frame to clear all the local references.
        my_jenv.contents.contents.PopLocalFrame(my_jenv, null);
        this._sendNotification(enabled ? "hostSavingEnabled" : "hostSavingDisabled", hostname);
        resolve(null);
      } catch (ex) {
        this.log("_setLoginSavingEnabled JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * findLogins
   *
   */
  findLogins : function (count, hostname, formSubmitURL, httpRealm) {
    let loginData = {
      hostname: hostname,
      formSubmitURL: formSubmitURL,
      httpRealm: httpRealm
    };

    let matchData = { };
    for (let field of ["hostname", "formSubmitURL", "httpRealm"]) {
      if (loginData[field] != '') {
        matchData[field] = loginData[field];
      }
    }

    let [logins, ids] = this._searchLogins(matchData);
    this.log("_findLogins: returning " + logins.length + " logins");
    count.value = logins.length; // needed for XPCOM
    return logins;
  },


  /*
   * countLogins
   *
   */
  countLogins : function (hostname, formSubmitURL, httpRealm) {
    let resultLogins = this.findLogins({}, hostname, formSubmitURL, httpRealm);
    if (resultLogins.length == 0 && formSubmitURL != null &&
        formSubmitURL != "" && formSubmitURL != "javascript:") {
      let formSubmitURI = Services.io.newURI(formSubmitURL, null, null);
      let newScheme = null;
      if (formSubmitURI.scheme == "http") {
        newScheme = "https";
      } else if (formSubmitURI.scheme == "https") {
        newScheme = "http";
      }
      if (newScheme) {
        let newFormSubmitURL = newScheme + "://" + formSubmitURI.hostPort;
        resultLogins = this.findLogins({}, hostname, newFormSubmitURL, httpRealm);
      }
    }
    this.log("_countLogins: counted logins: " + resultLogins.length);
    return resultLogins.length;
  },


  /*
   * uiBusy
   */
  get uiBusy() {
    return false;
  },


  /*
   * isLoggedIn
   */
  get isLoggedIn() {
    return true;
  },


  /*
   * _waitForSync
   *
   * Private method to wait for a promise to resolve synchronously.
   *
   * Returns resolved promise value or throw an error if the promised is rejected.
   */
  _waitForSync : function(promise) {
    let cb = Async.makeSyncCallback();
    Promise.resolve(promise).then(returnValue => cb.apply(null, returnValue ? returnValue : null)).catch(e => {
      this.log("_waitForSync Promise failure:  " + e.name + " : " + e.message);
      cb.throw(e);
    });
    return Async.waitForSyncCallback(cb);
  },

  _getLoginsAccessor : function(my_jenv) {
    if (!my_jenv) {
      throw new Error('my_jenv pointer is undefined');
    }

    JNI.LoadClass(my_jenv, this._SIG.Cursor.substr(1, this._SIG.Cursor.length - 2), {
      methods: [
        { name: 'moveToFirst', sig: '()Z' },
        { name: 'moveToNext', sig: '()Z' },
        { name: 'isAfterLast', sig: '()Z' },
        { name: 'getColumnIndex', sig: '(' + this._SIG.String + ')I' },
        { name: 'getString', sig: '(I)' + this._SIG.String },
        { name: 'getLong', sig: '(I)J' },
        { name: 'close', sig: '()V' },
      ]
    });

    JNI.LoadClass(my_jenv, this._SIG.ContentValues.substr(1, this._SIG.ContentValues.length - 2), {
      constructors: [{
        name: "<init>",
        sig: "()V"
      }],
      methods: [
        { name: 'put', sig: '(' + this._SIG.String + this._SIG.String + ')V' },
        { name: 'toString', sig: '()' + this._SIG.String },
        // { name: 'put', sig: '(' + this._SIG.String + 'J)V' },
      ]
    });

    JNI.LoadClass(my_jenv, this._SIG.LoginsAccessor.substr(1, this._SIG.LoginsAccessor.length - 2), {
      methods: [
        { name: 'searchLogins',
          sig: '(' +
               this._SIG.String +
               '[' + this._SIG.String +
               ')' +
               this._SIG.Cursor
        },
        { name: 'getAllDisabledHosts', sig: '()' + this._SIG.Cursor },
        { name: 'addLogin', sig: '(' + this._SIG.ContentValues + ')V' },
        { name: 'removeLogin', sig: '(J)V' },
        { name: 'modifyLogin', sig: '(J'+ this._SIG.ContentValues + ')V' },
        { name: 'removeAllLogins', sig: '()V' },
        { name: 'getLoginsSavedEnabled', sig: '(' + this._SIG.String + ')' + this._SIG.Cursor },
        { name: 'setLoginSavingEnabled', sig: '(' + this._SIG.String + 'Z)V' },
      ]
    });

    var geckoAppShell = JNI.LoadClass(my_jenv, this._SIG.GeckoAppShell.substr(1, this._SIG.GeckoAppShell.length - 2), {
      static_methods: [
        { name: 'getLoginsAccessor', sig: '()' + this._SIG.LoginsAccessor }
      ]
    });

    return geckoAppShell.getLoginsAccessor();
  },


  _populateContentValues : function(my_jenv, loginClone) {
      if (!my_jenv) {
        throw new Error('my_jenv pointer is undefined');
      }

      function isValidJavaString(s) {
        return s || s === "";
      }

      let contentValues = JNI.classes.android.content.ContentValues["new"]();
      // Test for valid Java string for text columns.
      var jHostName = isValidJavaString(loginClone.hostname) ? JNI.NewString(my_jenv, loginClone.hostname) : this._SIG.NULL;
      var jHttpRealm = isValidJavaString(loginClone.httpRealm) ? JNI.NewString(my_jenv, loginClone.httpRealm) : this._SIG.NULL;
      var jFormSubmitURL = isValidJavaString(loginClone.formSubmitURL) ? JNI.NewString(my_jenv, loginClone.formSubmitURL) : this._SIG.NULL;
      var jUserNameField = isValidJavaString(loginClone.usernameField) ? JNI.NewString(my_jenv, loginClone.usernameField) : this._SIG.NULL;
      var jPasswordField = isValidJavaString(loginClone.passwordField) ? JNI.NewString(my_jenv, loginClone.passwordField) : this._SIG.NULL;
      var jUserName = isValidJavaString(loginClone.username) ? JNI.NewString(my_jenv, loginClone.username) : this._SIG.NULL;
      var jPassword = isValidJavaString(loginClone.password) ? JNI.NewString(my_jenv, loginClone.password) : this._SIG.NULL;

      // GUID is generated in LoginsProvider if null or empty.
      var jGUID = loginClone.guid ? JNI.NewString(my_jenv, loginClone.guid) : this._SIG.NULL;
      var jEncType = JNI.NewString(my_jenv, loginClone.encType ? loginClone.encType : "0");

      // Following is a ugly conversion of long to String but this avoid overloaded put method in ContentValues with long to Long conversion.
      var jTimeCreated = loginClone.timeCreated ? JNI.NewString(my_jenv, "" + loginClone.timeCreated) : this._SIG.NULL;
      var jTimeLastUsed = loginClone.timeLastUsed ? JNI.NewString(my_jenv, "" + loginClone.timeLastUsed) : this._SIG.NULL;
      var jTimePasswordChanged = loginClone.timePasswordChanged ? JNI.NewString(my_jenv, "" + loginClone.timePasswordChanged) : this._SIG.NULL;
      var jTimesUsed =  JNI.NewString(my_jenv, loginClone.timesUsed ?  "" + loginClone.timesUsed : "0");

      // Keys have to be kept in sync with BrowserContract$Logins class.
      contentValues.put(JNI.NewString(my_jenv, "hostname"), jHostName);
      contentValues.put(JNI.NewString(my_jenv, "httpRealm"), jHttpRealm);
      contentValues.put(JNI.NewString(my_jenv, "formSubmitURL"), jFormSubmitURL);
      contentValues.put(JNI.NewString(my_jenv, "usernameField"), jUserNameField);
      contentValues.put(JNI.NewString(my_jenv, "passwordField"), jPasswordField);
      contentValues.put(JNI.NewString(my_jenv, "encryptedUsername"), jUserName);
      contentValues.put(JNI.NewString(my_jenv, "encryptedPassword"), jPassword);
      contentValues.put(JNI.NewString(my_jenv, "guid"), jGUID);
      contentValues.put(JNI.NewString(my_jenv, "encType"), jEncType);
      contentValues.put(JNI.NewString(my_jenv, "timeCreated"), jTimeCreated);
      contentValues.put(JNI.NewString(my_jenv, "timeLastUsed"), jTimeLastUsed);
      contentValues.put(JNI.NewString(my_jenv, "timePasswordChanged"), jTimePasswordChanged);
      contentValues.put(JNI.NewString(my_jenv, "timesUsed"), jTimesUsed);

      return contentValues;
  },


  /*
   * _searchLogins
   *
   * Private method to perform arbitrary searches on any field.
   *
   * Returns [logins, ids] for logins that match the arguments, where logins
   * is an array of encrypted nsLoginInfo and ids is an array of associated
   * ids in the database.
   */
  _searchLogins : function(matchData) {
    let selectionQuery = [], selectionParams = [];

    for (let field in matchData) {
      let value = matchData[field];
      switch (field) {
        // Historical compatibility requires this special case
        case "formSubmitURL":
          if (value != null) {
              // As we also need to check for different schemes at the URI
              // this case gets handled by filtering the result of the query.
              break;
          }
        // Android CP id to _id mapping.
        case "id":
          if (value) {
            selectionQuery.push("_id = ?");
            selectionParams.push(value);
          }
          break;
        // Normal cases.
        case "hostname":
        case "httpRealm":
        case "usernameField":
        case "passwordField":
        case "encryptedUsername":
        case "encryptedPassword":
        case "guid":
        case "encType":
        case "timeCreated":
        case "timeLastUsed":
        case "timePasswordChanged":
        case "timesUsed":
          if (value) {
            selectionQuery.push(field + " = ?");
            selectionParams.push(value);
          } else {
            selectionQuery.push(field + " is null");
          }
          break;
        // Fail if caller requests an unknown property.
        default:
          throw new Error("Unexpected field: " + field);
      }
    }

    return this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;

      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        JNI.LoadClass(my_jenv, '[' + this._SIG.String);
        let StringArray = JNI.classes.java.lang.String.array;

        // Allocate a local reference frame with enough space (2 for the String and StringArray).
        my_jenv.contents.contents.PushLocalFrame(my_jenv, 2);

        let selectionArgs = selectionParams.length ? StringArray.new(selectionParams.length) : this._SIG.NULL;
        if (selectionParams.length) {
          selectionArgs.setElements(0, selectionParams);
        }

        let selection = selectionQuery.length ? JNI.NewString(my_jenv, selectionQuery.join(" AND ")) : this._SIG.NULL;

        let cursor = loginsAccessor.searchLogins(selection, selectionArgs);

        let logins = [], ids = [], fallbackLogins = [], fallbackIds = [];
        if (!cursor) {
          // Defend against null cursor.
          resolve([[logins, ids]]);
          return;
        }

        try {
          cursor.moveToFirst();
          while (!cursor.isAfterLast()) {
            // Allocate a local reference frame with enough space (8 String read).
            my_jenv.contents.contents.PushLocalFrame(my_jenv, 8);

            // Create the new nsLoginInfo object, push to array
            let login = Cc["@mozilla.org/login-manager/loginInfo;1"].
                        createInstance(Ci.nsILoginInfo);
            login.init(JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("hostname"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("formSubmitURL"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("httpRealm"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("encryptedUsername"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("encryptedPassword"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("usernameField"))),
                       JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("passwordField"))));
            // set nsILoginMetaInfo values
            login.QueryInterface(Ci.nsILoginMetaInfo);
            login.guid = JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("guid")));
            login.timeCreated = cursor.getLong(cursor.getColumnIndex("timeCreated"));
            login.timeLastUsed = cursor.getLong(cursor.getColumnIndex("timeLastUsed"));
            login.timePasswordChanged = cursor.getLong(cursor.getColumnIndex("timePasswordChanged"));
            login.timesUsed = cursor.getLong(cursor.getColumnIndex("timesUsed"));

            if (login.formSubmitURL == "" || typeof(matchData.formSubmitURL) == "undefined" ||
                login.formSubmitURL == matchData.formSubmitURL) {
                logins.push(login);
                ids.push(cursor.getLong(cursor.getColumnIndex("_id")));
            } else if (login.formSubmitURL != null &&
                       login.formSubmitURL != "javascript:" &&
                       matchData.formSubmitURL != "javascript:") {
              let loginURI = Services.io.newURI(login.formSubmitURL, null, null);
              let matchURI = Services.io.newURI(matchData.formSubmitURL, null, null);

              if (loginURI.hostPort == matchURI.hostPort &&
                  ((loginURI.scheme == "http" && matchURI.scheme == "https") ||
                  (loginURI.scheme == "https" && matchURI.scheme == "http"))) {
                fallbackLogins.push(login);
                fallbackIds.push(cursor.getLong(cursor.getColumnIndex("_id")));
              }
            }
            cursor.moveToNext();
            // Pop local reference frame to clear all the local references.
            my_jenv.contents.contents.PopLocalFrame(my_jenv, null);
          }
        } finally {
          // Close the cursor.
          cursor.close();
        }

        if (!logins.length && fallbackLogins.length) {
          this.log("_searchLogins: returning " + fallbackLogins.length + " fallback logins");
          resolve([[fallbackLogins, fallbackIds]]);
        }
        this.log("_searchLogins: returning " + logins.length + " logins");

        // Pop local reference frame to clear all the local references.
        my_jenv.contents.contents.PopLocalFrame(my_jenv, null);

        resolve([[logins, ids]]);
      } catch (ex) {
        this.log("_searchLogins JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * _sendNotification
   *
   * Send a notification when stored data is changed.
   */
  _sendNotification : function (changeType, data) {
    let dataObject = data;
    // Can't pass a raw JS string or array though notifyObservers(). :-(
    if (data instanceof Array) {
      dataObject = Cc["@mozilla.org/array;1"].
                   createInstance(Ci.nsIMutableArray);
      for (let i = 0; i < data.length; i++)
        dataObject.appendElement(data[i], false);
    } else if (typeof(data) == "string") {
      dataObject = Cc["@mozilla.org/supports-string;1"].
                   createInstance(Ci.nsISupportsString);
      dataObject.data = data;
    }
    Services.obs.notifyObservers(dataObject, "passwordmgr-storage-changed", changeType);
  },


  /*
   * _getIdForLogin
   *
   * Returns an array with two items: [id, login]. If the login was not
   * found, both items will be null. The returned login contains the actual
   * stored login (useful for looking at the actual nsILoginMetaInfo values).
   */
  _getIdForLogin : function (login) {
    let matchData = { };
    for (let field of ["hostname", "formSubmitURL", "httpRealm"])
      if (login[field] != '') {
        matchData[field] = login[field];
      }
    let [logins, ids] = this._searchLogins(matchData);

    let id = null;
    let foundLogin = null;

    for (let i = 0; i < logins.length; i++) {
      if (!logins[i].equals(login)) {
        continue;
      }

      // We've found a match, set id and break
      foundLogin = logins[i];
      id = ids[i];
      break;
    }

    return [id, foundLogin];
  },


  /*
   * _queryDisabledHosts
   *
   * Returns an array of hostnames from the database according to the
   * criteria given in the argument. If the argument hostname is null, the
   * result array contains all hostnames
   */
  _queryDisabledHosts : function (hostname) {
    return this._waitForSync(new Promise((resolve, reject) => {
      var my_jenv;
      try {
        my_jenv = JNI.GetForThread();
        let loginsAccessor = this._getLoginsAccessor(my_jenv);
        // Allocate a local reference frame with enough space (1 for the hostname).
        my_jenv.contents.contents.PushLocalFrame(my_jenv, 1);
        let jHostName = hostname ? JNI.NewString(my_jenv, hostname) : this._SIG.NULL
        let cursor = loginsAccessor.getLoginsSavedEnabled(jHostName);
        let disabledHosts = [];

        if (!cursor) {
          // Defend against null cursor.
          resolve([disabledHosts]);
          return;
        }

        try {
          cursor.moveToFirst();
          while (!cursor.isAfterLast()) {
            // Allocate a local reference frame with enough space (1 String read).
            my_jenv.contents.contents.PushLocalFrame(my_jenv, 1);

            disabledHosts.push(JNI.ReadString(my_jenv, cursor.getString(cursor.getColumnIndex("hostname"))));
            cursor.moveToNext();

            // Pop local reference frame to clear all the local references.
            my_jenv.contents.contents.PopLocalFrame(my_jenv, null);
          }
        } finally {
          // Close the cursor.
          cursor.close();
        }

        // Pop local reference frame to clear all the local references.
        my_jenv.contents.contents.PopLocalFrame(my_jenv, null);

        resolve([disabledHosts]);
      } catch (ex) {
        this.log("_queryDisabledHosts JNI failure:  " + ex.name + " : " + ex.message);
        reject(ex);
      } finally {
        if (my_jenv) {
          JNI.UnloadClasses(my_jenv);
        }
      }
    }));
  },


  /*
   * _isGuidUnique
   *
   * Checks to see if the specified GUID already exists.
   */
  _isGuidUnique : function (guid) {
    let [logins, ids] = this._searchLogins({"guid" : guid});
    return ids.length == 0;
  }
}; // end of nsLoginManagerStorage_fennecStorage implementation

XPCOMUtils.defineLazyGetter(this.LoginManagerStorage_fennecStorage.prototype, "log", () => {
  let logger = LoginHelper.createLogger("Login storage");
  return logger.log.bind(logger);
});

var component = [LoginManagerStorage_fennecStorage];
this.NSGetFactory = XPCOMUtils.generateNSGetFactory(component);