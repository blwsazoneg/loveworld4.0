(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.sendMessageRequest = void 0;

var _constants = require("../constants");

const sendMessageRequest = ({
  sendMessageOptions,
  environment = 'prod'
}) => {
  return fetch(`${_constants.kingsChatApiPaths[environment]}/api/users/${sendMessageOptions.userIdentifier}/new_message`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sendMessageOptions.accessToken}`
    },
    body: JSON.stringify({
      message: {
        body: {
          text: {
            body: sendMessageOptions.message
          }
        }
      }
    })
  }).then(response => {
    if (response.ok) {
      return response.json();
    }

    return Promise.reject(Error('error'));
  }).catch(error => {
    return Promise.reject(Error(error.message));
  });
};

exports.sendMessageRequest = sendMessageRequest;
var _default = {
  sendMessageRequest
};
exports.default = _default;
},{"../constants":3}],2:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.refreshAuthenticationTokenRequest = void 0;

var _constants = require("../constants");

const refreshAuthenticationTokenRequest = ({
  refreshAuthenticationTokenOptions,
  environment = 'prod'
}) => {
  return fetch(`${_constants.kingsChatApiPaths[environment]}/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: refreshAuthenticationTokenOptions.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshAuthenticationTokenOptions.refreshToken
    })
  }).then(response => {
    if (response.ok) {
      return response.json().then(payload => {
        return {
          accessToken: payload.access_token,
          expiresInMillis: payload.expires_in_millis,
          refreshToken: payload.refresh_token
        };
      });
    }

    return Promise.reject(Error('error'));
  }).catch(error => {
    return Promise.reject(Error(error.message));
  });
};

exports.refreshAuthenticationTokenRequest = refreshAuthenticationTokenRequest;
var _default = {
  refreshAuthenticationTokenRequest
};
exports.default = _default;
},{"../constants":3}],3:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.kingsChatApiPaths = exports.allowedResponseOrigins = exports.authorizationURLs = void 0;
const authorizationURLs = {
  dev: 'http://localhost:5050',
  // Development
  staging: 'https://accounts.staging.kingsch.at',
  // Staging ENV
  prod: 'https://accounts.kingsch.at' // Production ENV

};
exports.authorizationURLs = authorizationURLs;
const allowedResponseOrigins = ['http://localhost:5050', // Development
'https://accounts.staging.kingsch.at', // Testing
'https://accounts.kingsch.at'];
exports.allowedResponseOrigins = allowedResponseOrigins;
const kingsChatApiPaths = {
  dev: 'http://localhost:8000',
  // Development
  staging: 'https://kc-connect.appunite.com',
  // Staging ENV
  prod: 'https://connect.kingsch.at' // Production ENV

};
exports.kingsChatApiPaths = kingsChatApiPaths;
var _default = {
  authorizationURLs,
  allowedResponseOrigins,
  kingsChatApiPaths
};
exports.default = _default;
},{}],4:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.sendMessage = exports.refreshAuthenticationToken = exports.login = void 0;

var _check = require("./utils/check.utils");

var _window = require("./utils/window.utils");

var _token = require("./api/token.api");

var _message = require("./api/message.api");

var _constants = require("./constants");

/**
 * This request user permission to use his/her account for any listed scope
 * @returns {authenticationTokenResponseI} authenticationTokenResponse
 * @param {loginOptionsI} loginOptions
 * @param {env} environment
 */
const login = (loginOptions, environment) => {
  try {
    (0, _check.validEnvironment)(environment);
    (0, _check.validLoginOptions)(loginOptions);
    return (0, _window.loginWindow)(new URL(_constants.authorizationURLs[environment || 'prod']), loginOptions);
  } catch (error) {
    return Promise.reject(error);
  }
};
/**
 * This refresh access token received earlier
 * @returns {authenticationTokenResponseI} authenticationTokenResponse
 * @param {refreshAuthenticationTokenOptionsI} refreshAuthenticationTokenOptions
 * @param {env} environment
 */


exports.login = login;

const refreshAuthenticationToken = (refreshAuthenticationTokenOptions, environment) => {
  try {
    (0, _check.validEnvironment)(environment);
    (0, _check.validRefreshAuthenticationTokenOptions)(refreshAuthenticationTokenOptions);
    return (0, _token.refreshAuthenticationTokenRequest)({
      refreshAuthenticationTokenOptions,
      environment: environment || 'prod'
    });
  } catch (error) {
    return Promise.reject(error);
  }
};
/**
 * This request send message to another KingsChat user
 * @returns {string} info
 * @param {sendMessageOptionsI} sendMessageOptions
 * @param {env} environment - optional environment change
 */


exports.refreshAuthenticationToken = refreshAuthenticationToken;

const sendMessage = (sendMessageOptions, environment) => {
  try {
    (0, _check.validEnvironment)(environment);
    (0, _check.validSendMessageOptions)(sendMessageOptions);
    return (0, _message.sendMessageRequest)({
      sendMessageOptions,
      environment: environment || 'prod'
    });
  } catch (error) {
    return Promise.reject(error);
  }
};

exports.sendMessage = sendMessage;
var _default = {
  login,
  refreshAuthenticationToken,
  sendMessage
};
exports.default = _default;
},{"./api/message.api":1,"./api/token.api":2,"./constants":3,"./utils/check.utils":5,"./utils/window.utils":7}],5:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.validSendMessageOptions = exports.validRefreshAuthenticationTokenOptions = exports.validLoginOptions = exports.validEnvironment = void 0;

const validEnvironment = environment => {
  if (environment) {
    const allowedEnvironments = ['dev', 'staging', 'prod'];

    if (typeof environment !== 'string' || !allowedEnvironments.includes(environment)) {
      throw Error('environment is invalid');
    }
  }
};

exports.validEnvironment = validEnvironment;

const validLoginOptions = loginOptions => {
  if (!loginOptions) {
    throw Error('loginOptions are not defined!');
  }

  if (!loginOptions.scopes) {
    throw Error('scopes are not defined!');
  } else if (!Array.isArray(loginOptions.scopes)) {
    throw Error(`scopes are type of ${typeof loginOptions.scopes} instead of Array`);
  }

  if (!loginOptions.clientId) {
    throw Error('clientId is not defined!');
  } else if (typeof loginOptions.clientId !== 'string') {
    throw Error(`clientId is type of ${typeof loginOptions.clientId} instead of string`);
  }
};

exports.validLoginOptions = validLoginOptions;

const validRefreshAuthenticationTokenOptions = refreshAuthenticationTokenOptions => {
  if (!refreshAuthenticationTokenOptions) {
    throw Error('refreshAuthenticationTokenOptions are not defined!');
  }

  if (!refreshAuthenticationTokenOptions.clientId) {
    throw Error('clientId is not defined!');
  } else if (typeof refreshAuthenticationTokenOptions.clientId !== 'string') {
    throw Error(`clientId is type of ${typeof refreshAuthenticationTokenOptions.clientId} instead of string`);
  }

  if (!refreshAuthenticationTokenOptions.refreshToken) {
    throw Error('refreshToken is not defined!');
  } else if (typeof refreshAuthenticationTokenOptions.refreshToken !== 'string') {
    throw Error(`refreshToken is type of ${typeof refreshAuthenticationTokenOptions.refreshToken} instead of string`);
  }
};

exports.validRefreshAuthenticationTokenOptions = validRefreshAuthenticationTokenOptions;

const validSendMessageOptions = sendMessageOptions => {
  if (!sendMessageOptions) {
    throw Error('sendMessageOptions are not defined!');
  }

  if (!sendMessageOptions.message) {
    throw Error('message is not defined!');
  } else if (typeof sendMessageOptions.message !== 'string') {
    throw Error(`message is type of ${typeof sendMessageOptions.message} instead of string`);
  }

  if (!sendMessageOptions.accessToken) {
    throw Error('accessToken is not defined!');
  } else if (typeof sendMessageOptions.accessToken !== 'string') {
    throw Error(`accessToken is type of ${typeof sendMessageOptions.accessToken} instead of string`);
  }

  if (!sendMessageOptions.userIdentifier) {
    throw Error('userIdentifier is not defined!');
  } else if (typeof sendMessageOptions.userIdentifier !== 'string') {
    throw Error(`userIdentifier is type of ${typeof sendMessageOptions.userIdentifier} instead of string`);
  }
};

exports.validSendMessageOptions = validSendMessageOptions;
var _default = {
  validEnvironment,
  validLoginOptions,
  validRefreshAuthenticationTokenOptions,
  validSendMessageOptions
};
exports.default = _default;
},{}],6:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.parseScopesArrayToString = void 0;

const parseScopesArrayToString = arrayToParse => {
  if (!arrayToParse) {
    throw Error('scopes array is not defined!');
  } else if (!Array.isArray(arrayToParse)) {
    throw Error(`scopes is type of ${typeof arrayToParse} instead of Array`);
  } else {
    let parsed = '[';
    arrayToParse.forEach((el, index) => {
      if (typeof el !== 'string') throw Error(`scope ${el}, at index ${index} is not string!`);

      if (index !== 0) {
        parsed += ', ';
      }

      parsed += `"${el}"`;
    });
    parsed += ']';
    return parsed;
  }
};

exports.parseScopesArrayToString = parseScopesArrayToString;
var _default = {
  parseScopesArrayToString
};
exports.default = _default;
},{}],7:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.loginWindow = void 0;

var _constants = require("../constants");

var _parse = require("./parse.utils");

/* global window */
function newWindowOptions() {
  if (!window) throw Error('No window defined');
  const windowArea = {
    width: Math.min(Math.floor(window.outerWidth * 0.9), 950),
    height: Math.min(Math.floor(window.outerHeight * 0.9), 600)
  };
  windowArea.left = Math.floor(window.screenX + (window.outerWidth - windowArea.width) / 2);
  windowArea.top = Math.floor(window.screenY + (window.outerHeight - windowArea.height) / 8);
  return `toolbar=0,scrollbars=1,status=1,resizable=1,location=1,menuBar=0,
    width=${windowArea.width},height=${windowArea.height},
    left=${windowArea.left},top=${windowArea.top}`;
}

function newWindowUrl({
  myUrl,
  options
}) {
  const url = new URL(myUrl.href);
  url.searchParams.append('client_id', options.clientId || '');
  url.searchParams.append('scopes', (0, _parse.parseScopesArrayToString)(options.scopes));
  url.searchParams.append('redirect_uri', window.location.origin);
  url.searchParams.append('post_message', '1');
  return url;
}

const loginWindow = (myUrl, options) => {
  const windowOptions = newWindowOptions();
  const windowURL = newWindowUrl({
    myUrl,
    options
  });
  const authWindow = window.open(windowURL.href, '_blank', windowOptions);

  if (!authWindow) {
    return Promise.reject(Error('You have to enable popups to show login window'));
  } // Listen to message from child window


  return new Promise((resolve, reject) => {
    const listener = msg => {
      /* Ignore self messages like setImmediate - Messages from other windows won't have source for security reasons */
      if (msg.source === window) {
        return;
      }

      if (!_constants.allowedResponseOrigins.includes(msg.origin)) {
        authWindow.close();
        reject(Error('Not allowed message origin'));
      }

      if (msg.data) {
        authWindow.close();

        if (msg.data.error) {
          reject(Error(msg.data.error));
        } else {
          resolve(msg.data);
        }
      } else {
        reject(Error('Bad Request'));
      }
    };

    window.addEventListener('message', listener, false);
    const interval = setInterval(() => {
      if (!authWindow.window) {
        window.removeEventListener('message', listener, false);
        clearInterval(interval);
        reject(Error('User closed window before allowing access'));
      }
    }, 350);
  });
};

exports.loginWindow = loginWindow;
var _default = {
  loginWindow
};
exports.default = _default;
},{"../constants":3,"./parse.utils":6}],8:[function(require,module,exports){
// src/kingschat-entry.js
window.kingsChatWebSdk = require('kingschat-web-sdk');
},{"kingschat-web-sdk":4}]},{},[8]);
