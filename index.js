var request = require('request');
var fs = require('fs');
var tmi = require('tmi.js');
var google = require('googleapis');
var colors = require('colors');
var OAuth2 = google.auth.OAuth2;
var youtube = google.youtube('v3');
var express = require('express');
var util = require('util');
var app = express();

/*******************
 *    CONSTANTS    *
 *******************/

const TWITCH_OAUTH = 'oauth:xxxxxxxxxxxxxxxxxx';
const YOUTUBE_OAUTH_ID = 'xxxxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com';
const YOUTUBE_OAUTH_SECRET = 'xxxxxxxxxxxxxxx';
const YOUTUBE_OAUTH_CALLBACK_URL = 'http://stream-chat-relay.denerdtv.stream:8080/callback';
const YOUTUBE_TOKEN_PATH = __dirname + '/tokens.txt';
const LOGS_PATH = __dirname + '/logs/logs' + Date.now() + '.log';
const STDOUT_PATH = __dirname + '/logs/stdout' + Date.now() + '.log';
const STDERR_PATH = __dirname + '/logs/errout' + Date.now() + '.log';

const TWITCH_BOT_NAME = 'youtube_chat';
const YOUTUBE_BOT_NAME = 'twitch_chat';

const HTTP_PORT = 8080;

/*******************
 *    VARIABLES    *
 *******************/

var twitchConnected = false;
var youtubeAuthenticated = false;
var youtubeMessagesPolled = 0;
var youtubeLiveChatId = 'EiEKGFVDSXcxSENpTGVDREpKMXF1TlZfZHNVQRIFL2xpdmU';
var nextPageToken = undefined;

var options = {
    options: {
        debug: true
    },
    connection: {
        cluster: 'aws',
        reconnect: true
    },
    identity: {
        username: 'youtube_chat',
        password: TWITCH_OAUTH
    },
    channels: ['de_nerdTV']
};

var oauth2Client = new OAuth2(
    YOUTUBE_OAUTH_ID,
    YOUTUBE_OAUTH_SECRET,
    YOUTUBE_OAUTH_CALLBACK_URL
);

var scopes = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly'
];

/*********************
 *    STATIC CODE    *
 *********************/

var log_file = fs.createWriteStream(LOGS_PATH, {flags: 'w'});
var log_stdout = process.stdout;

var out_file = fs.createWriteStream(STDOUT_PATH);
var err_file = fs.createWriteStream(STDERR_PATH);

process.stdout.write = out_file.write.bind(out_file);
process.stderr.write = err_file.write.bind(err_file);

console.log = function (d) { //
    log_file.write(util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
};

process.on('uncaughtException', function (err) {
    console.error((err && err.stack) ? err.stack : err);
});

var twitch = new tmi.client(options);
twitch.connect();
loadTokensFromFile();


/***********************
 *    TWITCH EVENTS    *
 ***********************/

twitch.on('chat', function (channel, userstate, message, self) {
    if (userstate['display-name'] != TWITCH_BOT_NAME) {
        sayYoutube(userstate['display-name'] + ": " + message);
    }
});

twitch.on('connected', function (address, port) {
    twitchConnected = true;
});

/************************
 *    YOUTUBE EVENTS    *
 ************************/

function onYoutubeChat(m) {
    if (m.authorDetails.displayName != YOUTUBE_BOT_NAME) {
        console.log('[YouTube] ' + m.authorDetails.displayName + ": " + m.snippet.displayMessage);
        twitch.say('de_nerdTV', m.authorDetails.displayName + ": " + m.snippet.displayMessage)
    }
}

function sayYoutube(message) {
    var resource =
        {
            snippet: {
                type: "textMessageEvent",
                liveChatId: youtubeLiveChatId,
                textMessageDetails: {
                    messageText: message
                }
            }
        };

    youtube.liveChatMessages.insert({
        auth: oauth2Client,
        alt: 'json',
        part: 'snippet',
        resource: resource
    }, function (err, res) {
        if (err) {
            console.log('Error sending message to youtube: ' + err.message);
        }
    });
}

/***************
 *    PAGES    *
 ***************/

app.get('/', (req, res) => {
    var url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes
    });

    res.send('<a href="' + url + '">Auth</a>')
});

app.get('/status', (req, res) => {
    var p = '';

    p += '<table><tr><td>Twitch Connection:</td><td>' + twitchConnected + '</td></tr><br>';
    p += '<tr><td>Youtube Authenticated:</td><td>' + youtubeAuthenticated + '</td></tr><br>';
    p += '<tr><td>Youtube Messages Polled:</td><td>' + youtubeMessagesPolled + '</td></tr><br>';
    p += '<tr><td>Youtube Live Chat ID:</td><td>' + youtubeLiveChatId + '</td></tr><br></table>';

    res.send(p);
});

app.get('/callback', (req, res) => {
    try {
        console.log('Received code: ' + req.param('code'));

        setupCredentials(req.param('code'));

        youtubeAuthenticated = true;

        res.send(req.param('code') + '<br><br><br> <a href="/">Back Home</a><br><br><br><a href="/send?m=HelloWorld">Send test message</a>');
    } catch
        (e) {
        console.log('Error during callback')
        console.error(e);
    }
});

app.get('/setchatid', (req, res) => {
    youtubeLiveChatId = req.param('id');

    res.send(req);
});

app.get('/setchatidvideo', (req, res) => {
    youtube.videos.list({
        auth: oauth2Client,
        alt: 'json',
        part: 'liveStreamingDetails',
        id: req.param('id')
    }, function (err, res) {
        if (!err) {
            youtubeLiveChatId = res.items[0].liveStreamingDetails.activeLiveChatId;
            console.log('Setting chat ID via video ID: ' + youtubeLiveChatId);
        } else {
            console.log('Error setting chat ID via video ID');
            console.error(err);
        }
    });
});

app.get('/logs', (req, res) => {
    res.type('text');
    res.send(fs.readFileSync(LOGS_PATH));
});

app.get('/stdout', (req, res) => {
    res.type('text');
    res.send(fs.readFileSync(STDOUT_PATH));
});

app.get('/stderr', (req, res) => {
    res.type('text');
    res.send(fs.readFileSync(STDERR_PATH));
});

app.get('/send', (req, res) => {
    sayYoutube(req.param('m'));

    res.send('message sent');
});


app.get('/oauth', (req, res) => {
    res.send(oauth2Client);
});

app.get('/renew', (req, res) => {
    renewCredentials();
});

app.listen(HTTP_PORT, () => {
    console.log('Logging on ' + LOGS_PATH);
    console.log('STDOUT on: ' + STDOUT_PATH);
    console.log('STDERR on: ' + STDERR_PATH);

    console.log('Listening on ' + HTTP_PORT);
});

function renewCredentials() {
    oauth2Client.refreshAccessToken(function (err, tokens) {
        if (tokens) {
            oauth2Client.setCredentials(tokens);
            console.log('Credentials refreshed.');
        } else {
            console.log('Credentials not refreshed. No refresh tokens returned on refreshAccessToken().');
        }
    });
}

function checkCredentialsExpiration() {
    var currentTimeMillis = Date.now();

    if (currentTimeMillis > oauth2Client.credentials.expiry_date) {
        console.log('Credentials are expired, trying to use refresh token.');
        renewCredentials();
    }
}

function pollYoutubeMessages() {
    youtubeMessagesPolled++;
    process.stdout.write('-> ');
    checkCredentialsExpiration();
    getYoutubeMessages(nextPageToken, function (err, res) {
        if (!err) {
            for (var messages of res.items) {
                if (nextPageToken) {
                    onYoutubeChat(messages);
                }
            }
            nextPageToken = res.nextPageToken;

            process.stdout.write('Next message polling in: ' + res.pollingIntervalMillis + 'ms.\n');
            setTimeout(pollYoutubeMessages, res.pollingIntervalMillis);
        } else {
            console.log('Error polling messages.');
            console.error(err);
        }
    });
}

function getYoutubeMessages(pageToken, callback) {
    var resource = {
        auth: oauth2Client,
        liveChatId: youtubeLiveChatId,
        part: 'id,snippet,authorDetails'
    };

    if (pageToken) {
        resource.pageToken = pageToken;
    }

    youtube.liveChatMessages.list(resource, callback);
}

function setupCredentials(code) {
    oauth2Client.getToken(code, function (err, tokens) {
        if (!err) {
            oauth2Client.setCredentials(tokens);
            console.log('Credentials setup.');
        } else {
            console.log('OAuth2 getToken() returned error.');
            console.log(err);
        }

        if (tokens && tokens.refresh_token) {
            console.log('Tokens returned with Refresh Token, saving to file.');
            saveTokensToFile(tokens);
        } else {
            console.log('No Refresh Token returned, not saving credentials to file.');
        }

        pollYoutubeMessages();
    });
}

function loadTokensFromFile() {
    var tokens = undefined;

    try {
        tokens = JSON.parse(fs.readFileSync(YOUTUBE_TOKEN_PATH));
    } catch (e) {
        console.log('Error loading tokens from file: ' + e.message);
        tokens = undefined;
    }

    if (tokens && tokens.refresh_token) {
        oauth2Client.setCredentials(tokens);
        pollYoutubeMessages();
        console.log('Credentials loaded from file.');
    } else {
        console.log('Invalid credentials in file.');
    }
}

function saveTokensToFile(tokens) {
    try {
        fs.writeFileSync(YOUTUBE_TOKEN_PATH, JSON.stringify(tokens));
    } catch (e) {
        console.log('Error saving tokens to file: ' + e.message);
        console.error(e);
    }
}
