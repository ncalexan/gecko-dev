/* -*- Mode: Java; c-basic-offset: 4; tab-width: 20; indent-tabs-mode: nil; -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.search;

import org.mozilla.search.R;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

public class SearchActivity extends Activity {
    private static final String LOGTAG = "SearchActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(LOGTAG, "onCreate");

        setContentView(R.layout.search_activity);
    }

    @Override
    public void onResume() {
        super.onResume();
        Log.i(LOGTAG, "onResume");
    }
}
