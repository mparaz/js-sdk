//-----------------------------------------------------------------
// Copyright 2012 BrightContext Corporation
//
// Licensed under the MIT License defined in the 
// LICENSE file.  You may not use this file except in 
// compliance with the License.
//-----------------------------------------------------------------

BCC = ("undefined" == typeof(BCC)) ? {}: BCC;

/**
 * @class
 * <p>Represents a real-time stream of data.</p>
 * <p>For ThruChannels, this represents the default sub-channel, or any dynamic sub-channel created at runtime.</p>
 * <p>For QuantChannels, this represents any configured Input or Output using real-time server processing.</p>
 * @constructor
 * @param {number} procId <strong>Required</strong> - The processor id as configured in the management console.
 * @param {object} filters <strong>Optional</strong> - Only required when using run-time filtering.
 * @param {string} writeKey <strong>Optional</strong> - Only needed when messages will be sent on a write protected feed.
 * @param {object} listener <strong>Optional</strong> - Additional event listener with function handlers on event names.
 *
 * @description
 * <p>Feeds can be created manually and opened using the context, however it is typically much easier to simply call <code>project.feed(...)</code><p>
 *
 * @see BCC.Project#feed
 * @see BCC.Feed#addListener
 * 
 * @example
 * var f = new Feed(123);	// processor id from management console
 * 
 * f.onopen = function() {
 *   f.send({ 'hello' : 'feeds' });
 * };
 *
 * f.onmsgreceived = function(msg) {
 *   console.log(msg);
 * };
 *
 * var ctx = BCC.init('apikey');	// initialize a context only once
 * ctx.openFeed(f);	// use it to open feeds
 * // ... listen for events
 * ctx.closeFeed(f);	// use same context to close feeds when done with them
 */
BCC.Feed = function(procId, filters, writeKey, listener) {
	this.conn = null;
	this.feedHandler = null;
	this.dateFields = null;
	this.feedSettings = {
			"state" : "CLOSED",
			"feedKey" : null,
			"procId" : procId,
			"filters" : filters,
			"templateType" : null,
			"activeUserFields" : null,
			"msgContract" : null,
			"activeUserCycle" : null, // in secs
			"activeUserFlag" : null,
			"goInactiveTime" : null // in secs
	};
	this.writeKey = (!!writeKey) ? writeKey : null;

	/**
	 * Called by the constructor to initialize the object 
	 * @private
	 */
	this._init = function(){
	};

	/**
	 * Adds a listener to the feed.  Any one feed can have multiple listeners.
	 * All listeners will be dispatched events about the feed in the order they were added as listeners.
	 * Listeners can be removed using <code>removeListener</code>
	 *
	 * @param {object} listenerObj object that has one event handler per event name
	 * 
	 * @example
	 * f.addListener({
	 *   'onopen': function(f) {
	 *   },
	 *   'onerror': function(err) {
	 *   },
	 *   // other events ...
	 * });
	 * 
	 * @see onopen
	 * @see onclose
	 * @see onmsgreceived
	 * @see onmsgsent
	 * @see onopen
	 * @see onhistory
	 * @see onerror
	 * 
	 */
	this.addListener = function(listenerObj) {
		BCC.EventDispatcher.register(BCC.EventDispatcher.getObjectKey(this), listenerObj);
	};

	/**
	 * Removes a listener from the object
	 * @param {object} listenerObj the listener that was added using <code>addListener</code>
	 */
	this.removeListener = function(listenerObj) {
		BCC.EventDispatcher.unregister(BCC.EventDispatcher.getObjectKey(this), listenerObj);
	};

	/**
	 * Sets the feedHandler to the feed
	 * @param {BCC.FeedHandler} fh
	 * @private
	 */
	this.setFeedHandler = function(fh){
		this.feedHandler = fh;
	};

	/**
	 * <p>Unlocks a write protected feed.</p>
	 * <p>Write protection is an option that is off by default and must be turned on using the management console.
	 * Once enabled, a write key will be generated by the server.
	 * A write key must be set using this method before calling <code>send</code> if one was not provided when opening the feed using <code>project.feed(...)</code>.
	 * </p>
	 * @param {string} writeKey The value of the write key that was generated using the management console.
	 * @see BCC.Project#feed
	 */
	this.setWriteKey = function(writeKey){
		this.writeKey = writeKey;
	};
	
	/** @private */
	this._isInState = function(stateName) {
		if (!(!!this.feedSettings)) {
			this.feedSettings = {};
		}
		var is = (this.feedSettings.state == stateName);
		return is;
	};
	
	/** True if the feed is open, false otherwise */
	this.isOpen = function() {
		return this._isInState(BCC.Feed.State.OPEN);
	};
	
	/** True if the feed is closed, false otherwise */
	this.isClosed = function() {
		return this._isInState(BCC.Feed.State.CLOSED);
	};
	
	/** True if the feed encountered an error, false otherwise */
	this.hasError = function() {
		// TODO: probably should leave state alone and instead use a separate error property or array
		return this._isInState(BCC.Feed.State.ERROR);
	};
	
	/**
	 * This method reopens the feed over the connection and is used on reconnect.
	 */
	this.reopen = function(connection, fr){
		if (("undefined" == typeof(connection)) || (null === connection)) {
			BCC.Log.error("Invalid connection object, cannot open " + JSON.stringify(this));
			return;
		}
		this.conn = connection;
		BCC.Log.info("Reopening feed : " + this.feedSettings.procId,"BCC.Feed.reopen");
		var cmd = new BCC.Command("POST", "/feed/session/create.json", {feed : this.feedSettings});
		if(this.writeKey != null)
			cmd.addParam({writeKey: this.writeKey});
		var me = this;
		cmd.onresponse = function(msg) {
			BCC.Log.debug("Feed reopened succesfully.", "BCC.Feed.reopen");
		};
		cmd.onerror = function(err) {
			if (!!!!me.feedSettings) {
				me.feedSettings = {};
			}
			me.feedSettings.state = "error";
			BCC.Log.error("Error reopening feed : " + JSON.stringify(err), "BCC.Feed.reopen");
			var feedsForKey = fr.getAllFeedsForKey(me);
			for(var index = 0; index < feedsForKey.length; index++){
				var feedObj = feedsForKey[index];
				var errorEvent = new BCC.Event("onclose", BCC.EventDispatcher.getObjectKey(feedObj), feedObj);
				BCC.EventDispatcher.dispatch(errorEvent);
			}
		};
		cmd.send(connection);
	};

	/**
	 * This method opens the feed over the connection and registers it with the feedRegistry.
	 * Used by <code>context.openFeed()</code>.
	 * @param {BCC.Connection} connection 
	 * @param {BCC.FeedRegistry} feedRegistry
	 * @private
	 */
	this.open = function(connection, feedRegistry) {
		if (("undefined" == typeof(connection)) || (null === connection)) {
			BCC.Log.error("Invalid connection object, cannot open " + JSON.stringify(this));
			return;
		}
		
		this.conn = connection;
		BCC.Log.info("Opening feed : " + this.feedSettings.procId,"BCC.Feed.open");

		BCC.EventDispatcher.register(BCC.EventDispatcher.getObjectKey(this), this);
		if (listener != null)
			BCC.EventDispatcher.register(BCC.EventDispatcher.getObjectKey(this), listener);

		var cmd = new BCC.Command("POST", "/feed/session/create.json", {feed : this.feedSettings});
		if(this.writeKey != null)
			cmd.addParam({writeKey: this.writeKey});
			
		var me = this;
		
		cmd.onresponse = function(msg) {
			me.feedSettings = msg;
			me._extractDateFields(me.feedSettings);
			BCC.Log.info("Feed opened with Settings : " + JSON.stringify(me.feedSettings),"BCC.Feed.open");
			feedRegistry.registerFeed(me);
			BCC.EventDispatcher.register(me.feedSettings.feedKey, me);
			var openEvent = new BCC.Event("onopen", BCC.EventDispatcher.getObjectKey(me), me);
			BCC.EventDispatcher.dispatch(openEvent);
		};
		
		cmd.onerror = function(err) {
			if (!!!!me.feedSettings) {
				me.feedSettings = {};
			}
			me.feedSettings.state = "error";
			BCC.Log.error("Error opening feed: " + err, "BCC.Feed.open");
			var errorEvent = new BCC.Event("onerror", BCC.EventDispatcher.getObjectKey(me), err);
			BCC.EventDispatcher.dispatch(errorEvent);
		};
		
		cmd.send(connection);
	};

	/**
	 * <p>Closes the feed. Once a feed is closed, no events will be recieved on it, and no data can be sent to the server on it.</p>
	 * <p>If this is the last feed that was opened, the connection to the server will be closed as well.
	 * Any attempt to open a feed when no connection is open will open the connection to the server automatically.
	 * Thus, if switching between only two feeds, it might make more sense to open one, and then close the other
	 * rather than close one first.  This will avoid unnecessarily closing the connection.</p>
	 */
	this.close = function() {
		BCC._checkContextExists();
		BCC.ContextInstance.closeFeed(this);
	};
	
	/**
	 * Closes the feed with the server
	 * @private
	 */
	this._close = function(connection) {
		var me = this;
		
		var cmd = new BCC.Command("POST", "/feed/session/delete.json", {
			fklist : this.feedSettings.feedKey
		});
		
		cmd.onresponse = function(event) {
			me.feedSettings.state = "closed";
			me.feedHandler = null;
			me.conn = null;
			var closeEvent = new BCC.Event("onclose", BCC.EventDispatcher.getObjectKey(me), me);
			BCC.EventDispatcher.dispatch(closeEvent);
			
	        BCC.EventDispatcher.unregister(me.id, me);
	        BCC.EventDispatcher.unregister(me.feedSettings.feedKey, me);
	        me._cleanUpFeed();
		};
		
		cmd.onerror = function(err) {
			if (!!!!me.feedSettings) {
				me.feedSettings = {};
			}
			me.feedSettings.state = "error";
			BCC.Log.error("Error closing feed: " + err, "BCC.Feed.close");
			var errorEvent = new BCC.Event("onerror", BCC.EventDispatcher.getObjectKey(me), err);
			BCC.EventDispatcher.dispatch(errorEvent);
			
	        BCC.EventDispatcher.unregister(me.id, me);
	        BCC.EventDispatcher.unregister(me.feedSettings.feedKey, me);
	        me._cleanUpFeed();
		};
		
		var cx = ("undefined" == typeof(connection)) ? this.conn : connection;
		cmd.send(cx);
	};
	
	/**
	 * Clean up the connection
	 * @private
	 */
	this._cleanUpFeed = function(){
		BCC._checkContextExists();
		BCC.ContextInstance._unregisterFeed(this);

        // Close the connection if the feed registry is now completely empty
        if (BCC.ContextInstance.feedRegistry.isEmpty() & !!BCC.ContextInstance.conn) {
            BCC.ContextInstance.conn.close();
            BCC.ContextInstance.conn = null;
        }
	};

	/**
	 * Returns the feed Id
	 * @returns {string}
	 * @private
	 */
	this.getFeedKey = function() {
		return this.feedSettings.feedKey;
	};

	/**
	 * Returns the feed settings
	 * @returns {JSON}
	 * @private
	 */
	this.getFeedSettings = function() { // used by feed registry to get feed settings from one feed so it can reload another
		return this.feedSettings;
	};

	/**
	 * Reloads the feed settings and reregisters the listeners for the new feed id
	 * @param {object} feedSettings
	 * @private
	 */
	this.reloadFeedSettings = function(feedSettings) {
		//var oldFeedKey = this.feedSettings.feedKey;
		BCC.EventDispatcher.register(BCC.EventDispatcher.getObjectKey(this), this);
		if (listener != null)
			BCC.EventDispatcher.register(BCC.EventDispatcher.getObjectKey(this), listener);

		this.feedSettings = feedSettings;
		BCC.EventDispatcher.register(this.feedSettings.feedKey, this);
		this._extractDateFields(feedSettings);
		
		//TODO : Refresh the Feed Handlers
		/*var listenerList = BCC.EventDispatcher.getListeners(BCC.EventDispatcher.getObjectKey(this));
		for (var i=0; i<listenerList.length; i++){
			if(oldFeedKey != null) BCC.EventDispatcher.unregister(oldFeedKey, listenerList[i]);
			BCC.EventDispatcher.register(this.feedSettings.feedKey, listenerList[i]);
		}*/
	};

	/**
	 * <p>Sends a message to the server for processing and broadcasting.
	 * This is an asynchronous operation that may fail.
	 * Any notification of failure is delivered to all listeners using the <code>onerror</code> event handler.</p>
	 * <p>Possible types of failures:</p>
	 * <ul>
	 * <li>If message contract validation is turned on, the fields of the message will be validated client-side before sending to the server.</li>
	 * <li>Messages can only be sent on open feeds.  If a feed has not been opened, or a feed has been closed, no message will be sent.</li>
	 * <li>Attempting to send a message on a write protected feed that has not been unlocked using the correct write key will result in <code>onerror</code> event handler being fired.</li>
	 * </ul>
	 * 
	 * @param {object} msg
	 * <p>On QuantChannels, this is the message that should be sent for processing matching the shape of the Input.
	 * In other words, if the Input has three fields: <code>a</code>, <code>b</code> and <code>c</code> this message should have those three fields.
	 * Any attempt to send a message on an Output will have no effect.</p>
	 * <p>On ThruChannels, this may be any valid JSON to be broadcasted to all listeners.</p>
	 * 
	 */
	this.send = function(msg) {
		if(this.feedHandler != null && this.conn != null) {
			this.feedHandler.sendMsg(msg, this, this.conn);
		} else {
			BCC.Log.error("Feed is closed. Cannot send message over the feed at this time." ,"BCC.Feed.sendMsg");
		}
	};
	
	/**
	 * Sends a message over the feed
	 * @private
	 */
	this.sendMsg = this.send;
	
	/**
	 * Retrieves messages that were sent on a feed in the past.
	 * @param {number} limit <strong>Optional</strong> - Default 10.  The maximum number of historic messages to fetch.
	 * @param {date} ending <strong>Optional</strong> - Date object that represents the most recent date of a historic message that will be returned. Any message that occurred later than this date will be filtered out of the results.
	 * @param {function} completion <strong>Optional</strong> - Extra completion handler for the onhistory event.  This is only needed if you originally opened the feed using project.feed(), but did not provide an onhistory callback handler.  Method signature: <code>function (feed, history) {}</code>
	 * @example
   * // Method A - using a global event handler
   * p.feed({
	 *   onopen: function(f) {
	 *     f.history();
	 *   },
	 *   onhistory: function(f, h) {
	 *     console.log(h); // array of 10 most recent messages
	 *   }
   * });
   * 
	 * // Method B - using the inline history handler
	 * f.history(
	 *   3,	// fetch three messages
	 *   new Date(2012,0,3), // sent on or before Tue Jan 03 2012 00:00:00 local time
	 *   function(f,h) {
	 *     console.log(h);
	 *   }
	 * );
	 */
	this.history = function(limit, ending, completion) {
		var me = this,
				l = limit || 10,
				e = ending || new Date();

		var sinceTS = (new Date(e)).getTime();

		var cmd = new BCC.Command("GET", "/feed/message/history.json", {
			feedKey : this.feedSettings.feedKey,
			limit : l,
			sinceTS : sinceTS
		});
		
		cmd.onresponse = function(evt) {
			var historyEvent = new BCC.Event("onhistory", BCC.EventDispatcher.getObjectKey(me), evt);
			BCC.EventDispatcher.dispatch(historyEvent);

			if ('function' === typeof(completion)) {
				completion(me, evt);
			}
		};
		
		cmd.onerror = function(err) {
			BCC.Log.error("Error getting feed history: " + err, "BCC.Feed.getHistory");
			var errorEvent = new BCC.Event("onerror", BCC.EventDispatcher.getObjectKey(me), err);
			BCC.EventDispatcher.dispatch(errorEvent);
		};
		
		this.conn.send(cmd);
		return true;
	};

	/**
	 * Retrieves messages that were sent on a feed in the past.
	 * @private
	 */
	this.getHistory = this.history;
	
	this._extractDateFields = function(feedSettings){
		if(feedSettings.feedType == BCC.Feed.OUTPUT_TYPE){
			var dateFields = [];
			for (var index=0; index<feedSettings.msgContract.length; index++) {
				if(feedSettings.msgContract[index].fieldType == BCC.Feed.DATE_FIELD){
					dateFields.push(feedSettings.msgContract[index].fieldName);
				}
			}
			this.dateFields = dateFields.length > 0 ? dateFields : null;
		}
	};

	this.onfeedmessage = function(msg){
		if(typeof this.onmsgreceived == "function"){
			var msgJson = ("string" == typeof(msg)) ? JSON.parse(msg) : msg;
			if(this.dateFields != null){
				for (var index=0; index<this.dateFields.length; index++) {
					var field = this.dateFields[index];
					if(Object.prototype.hasOwnProperty.call(msgJson, field))
					msgJson[field] = new Date(parseInt(msgJson[field],10));
				}
			}
			this.onmsgreceived(msgJson);
		}
	};
	
	this._init();
	
	/**
	 * Fired when message is pushed down from the server to the client.
	 * @name BCC.Feed#onmsgreceived
	 * @event
	 * @see BCC.Project#feed
	 * @see BCC.Context#openFeed
	 */
	
	/**
	 * Fired after a message is successfully sent from the client to the server for processing or broadcasting.
	 * @name BCC.Feed#onmsgsent
	 * @event
	 * @see BCC.Feed#send
	 */
	
	/**
	 * Fired after the feed is opened and is ready for use.
	 * @name BCC.Feed#onopen
	 * @event
	 * @see BCC.Project#feed
	 * @see BCC.Context#openFeed
	 */
	
	/**
	 * Fired in response to a successful <code>getHistory</code>.
	 * @name BCC.Feed#onhistory
	 * @event
	 * @see BCC.Feed#getHistory
	 */
	
	/**
	 * Fired when the feed is successfully closed.
	 * @name BCC.Feed#onclose
	 * @event
	 * @see BCC.Feed#close
	 * @see BCC.Context#closeFeed
	 */
	
	/**
	 * Fired any time there is an error with any command.
	 * @name BCC.Feed#onerror
	 * @event
	 */
};

BCC.Feed.INPUT_TYPE = "IN";
BCC.Feed.OUTPUT_TYPE = "OUT";
BCC.Feed.UNPROCESSED_TYPE = "THRU";

BCC.Feed.DATE_FIELD = "D";

BCC.Feed.State = {
	OPEN: "open",
	CLOSED: "closed",
	ERROR: "error"
};