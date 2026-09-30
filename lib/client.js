window.__ModuleLoader__.load({
	id: "dsh-ui-auth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/@simplewebauthn/browser/script/helpers/bufferToBase64URLString.js
var require_bufferToBase64URLString = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/bufferToBase64URLString.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.bufferToBase64URLString = bufferToBase64URLString;
    function bufferToBase64URLString(buffer) {
      const bytes = new Uint8Array(buffer);
      let str = "";
      for (const charCode of bytes) {
        str += String.fromCharCode(charCode);
      }
      const base64String = btoa(str);
      return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/base64URLStringToBuffer.js
var require_base64URLStringToBuffer = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/base64URLStringToBuffer.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.base64URLStringToBuffer = base64URLStringToBuffer;
    function base64URLStringToBuffer(base64URLString) {
      const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
      const padLength = (4 - base64.length % 4) % 4;
      const padded = base64.padEnd(base64.length + padLength, "=");
      const binary = atob(padded);
      const buffer = new ArrayBuffer(binary.length);
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return buffer;
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/browserSupportsWebAuthn.js
var require_browserSupportsWebAuthn = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/browserSupportsWebAuthn.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2._browserSupportsWebAuthnInternals = void 0;
    exports2.browserSupportsWebAuthn = browserSupportsWebAuthn;
    function browserSupportsWebAuthn() {
      return exports2._browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== void 0 && typeof globalThis.PublicKeyCredential === "function");
    }
    exports2._browserSupportsWebAuthnInternals = {
      stubThis: (value) => value
    };
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/toPublicKeyCredentialDescriptor.js
var require_toPublicKeyCredentialDescriptor = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/toPublicKeyCredentialDescriptor.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.toPublicKeyCredentialDescriptor = toPublicKeyCredentialDescriptor;
    var base64URLStringToBuffer_js_1 = require_base64URLStringToBuffer();
    function toPublicKeyCredentialDescriptor(descriptor) {
      const { id } = descriptor;
      return {
        ...descriptor,
        id: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(id),
        transports: descriptor.transports,
        type: descriptor.type
      };
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/isValidDomain.js
var require_isValidDomain = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/isValidDomain.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isValidDomain = isValidDomain;
    function isValidDomain(hostname) {
      return (
        // Consider localhost valid as well since it's okay wrt Secure Contexts
        hostname === "localhost" || // Support punycode (ACE) or ascii labels and domains
        /^((xn--[a-z0-9-]+|[a-z0-9]+(-[a-z0-9]+)*)\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(hostname)
      );
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/webAuthnError.js
var require_webAuthnError = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/webAuthnError.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.WebAuthnError = void 0;
    var WebAuthnError = class extends Error {
      constructor({ message: message2, code, cause, name }) {
        super(message2, { cause });
        Object.defineProperty(this, "code", {
          enumerable: true,
          configurable: true,
          writable: true,
          value: void 0
        });
        this.name = name ?? cause.name;
        this.code = code;
      }
    };
    exports2.WebAuthnError = WebAuthnError;
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/identifyRegistrationError.js
var require_identifyRegistrationError = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/identifyRegistrationError.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.identifyRegistrationError = identifyRegistrationError;
    var isValidDomain_js_1 = require_isValidDomain();
    var webAuthnError_js_1 = require_webAuthnError();
    function identifyRegistrationError({ error, options }) {
      const { publicKey } = options;
      if (!publicKey) {
        throw Error("options was missing required publicKey property");
      }
      if (error.name === "AbortError") {
        if (options.signal instanceof AbortSignal) {
          return new webAuthnError_js_1.WebAuthnError({
            message: "Registration ceremony was sent an abort signal",
            code: "ERROR_CEREMONY_ABORTED",
            cause: error
          });
        }
      } else if (error.name === "ConstraintError") {
        if (publicKey.authenticatorSelection?.requireResidentKey === true) {
          return new webAuthnError_js_1.WebAuthnError({
            message: "Discoverable credentials were required but no available authenticator supported it",
            code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
            cause: error
          });
        } else if (
          // @ts-ignore: `mediation` doesn't yet exist on CredentialCreationOptions but it's possible as of Sept 2024
          options.mediation === "conditional" && publicKey.authenticatorSelection?.userVerification === "required"
        ) {
          return new webAuthnError_js_1.WebAuthnError({
            message: "User verification was required during automatic registration but it could not be performed",
            code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
            cause: error
          });
        } else if (publicKey.authenticatorSelection?.userVerification === "required") {
          return new webAuthnError_js_1.WebAuthnError({
            message: "User verification was required but no available authenticator supported it",
            code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
            cause: error
          });
        }
      } else if (error.name === "InvalidStateError") {
        return new webAuthnError_js_1.WebAuthnError({
          message: "The authenticator was previously registered",
          code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
          cause: error
        });
      } else if (error.name === "NotAllowedError") {
        return new webAuthnError_js_1.WebAuthnError({
          message: error.message,
          code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
          cause: error
        });
      } else if (error.name === "NotSupportedError") {
        const validPubKeyCredParams = publicKey.pubKeyCredParams.filter((param) => param.type === "public-key");
        if (validPubKeyCredParams.length === 0) {
          return new webAuthnError_js_1.WebAuthnError({
            message: 'No entry in pubKeyCredParams was of type "public-key"',
            code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
            cause: error
          });
        }
        return new webAuthnError_js_1.WebAuthnError({
          message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
          code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
          cause: error
        });
      } else if (error.name === "SecurityError") {
        const effectiveDomain = globalThis.location.hostname;
        if (!(0, isValidDomain_js_1.isValidDomain)(effectiveDomain)) {
          return new webAuthnError_js_1.WebAuthnError({
            message: `${globalThis.location.hostname} is an invalid domain`,
            code: "ERROR_INVALID_DOMAIN",
            cause: error
          });
        } else if (publicKey.rp.id !== effectiveDomain) {
          return new webAuthnError_js_1.WebAuthnError({
            message: `The RP ID "${publicKey.rp.id}" is invalid for this domain`,
            code: "ERROR_INVALID_RP_ID",
            cause: error
          });
        }
      } else if (error.name === "TypeError") {
        if (publicKey.user.id.byteLength < 1 || publicKey.user.id.byteLength > 64) {
          return new webAuthnError_js_1.WebAuthnError({
            message: "User ID was not between 1 and 64 characters",
            code: "ERROR_INVALID_USER_ID_LENGTH",
            cause: error
          });
        }
      } else if (error.name === "UnknownError") {
        return new webAuthnError_js_1.WebAuthnError({
          message: "The authenticator was unable to process the specified options, or could not create a new credential",
          code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
          cause: error
        });
      }
      return error;
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/webAuthnAbortService.js
var require_webAuthnAbortService = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/webAuthnAbortService.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.WebAuthnAbortService = void 0;
    var BaseWebAuthnAbortService = class {
      constructor() {
        Object.defineProperty(this, "controller", {
          enumerable: true,
          configurable: true,
          writable: true,
          value: void 0
        });
      }
      createNewAbortSignal() {
        if (this.controller) {
          const abortError = new Error("Cancelling existing WebAuthn API call for new one");
          abortError.name = "AbortError";
          this.controller.abort(abortError);
        }
        const newController = new AbortController();
        this.controller = newController;
        return newController.signal;
      }
      cancelCeremony() {
        if (this.controller) {
          const abortError = new Error("Manually cancelling existing WebAuthn API call");
          abortError.name = "AbortError";
          this.controller.abort(abortError);
          this.controller = void 0;
        }
      }
    };
    exports2.WebAuthnAbortService = new BaseWebAuthnAbortService();
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/toAuthenticatorAttachment.js
var require_toAuthenticatorAttachment = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/toAuthenticatorAttachment.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.toAuthenticatorAttachment = toAuthenticatorAttachment;
    var attachments = ["cross-platform", "platform"];
    function toAuthenticatorAttachment(attachment) {
      if (!attachment) {
        return;
      }
      if (attachments.indexOf(attachment) < 0) {
        return;
      }
      return attachment;
    }
  }
});

// node_modules/@simplewebauthn/browser/script/methods/startRegistration.js
var require_startRegistration = __commonJS({
  "node_modules/@simplewebauthn/browser/script/methods/startRegistration.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.startRegistration = startRegistration;
    var bufferToBase64URLString_js_1 = require_bufferToBase64URLString();
    var base64URLStringToBuffer_js_1 = require_base64URLStringToBuffer();
    var browserSupportsWebAuthn_js_1 = require_browserSupportsWebAuthn();
    var toPublicKeyCredentialDescriptor_js_1 = require_toPublicKeyCredentialDescriptor();
    var identifyRegistrationError_js_1 = require_identifyRegistrationError();
    var webAuthnAbortService_js_1 = require_webAuthnAbortService();
    var toAuthenticatorAttachment_js_1 = require_toAuthenticatorAttachment();
    async function startRegistration(options) {
      if (!options.optionsJSON && options.challenge) {
        console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
        options = { optionsJSON: options };
      }
      const { optionsJSON, useAutoRegister = false } = options;
      if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        throw new Error("WebAuthn is not supported in this browser");
      }
      const publicKey = {
        ...optionsJSON,
        challenge: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(optionsJSON.challenge),
        user: {
          ...optionsJSON.user,
          id: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(optionsJSON.user.id)
        },
        excludeCredentials: optionsJSON.excludeCredentials?.map(toPublicKeyCredentialDescriptor_js_1.toPublicKeyCredentialDescriptor)
      };
      const createOptions = {};
      if (useAutoRegister) {
        createOptions.mediation = "conditional";
      }
      createOptions.publicKey = publicKey;
      createOptions.signal = webAuthnAbortService_js_1.WebAuthnAbortService.createNewAbortSignal();
      let credential;
      try {
        credential = await navigator.credentials.create(
          // TODO: Newer versions of Deno require this casting, revisit once we're using Deno 2.6+
          createOptions
        );
      } catch (err) {
        throw (0, identifyRegistrationError_js_1.identifyRegistrationError)({ error: err, options: createOptions });
      }
      if (!credential) {
        throw new Error("Registration was not completed");
      }
      const { id, rawId, response, type } = credential;
      let transports = void 0;
      if (typeof response.getTransports === "function") {
        transports = response.getTransports();
      }
      let responsePublicKeyAlgorithm = void 0;
      if (typeof response.getPublicKeyAlgorithm === "function") {
        try {
          responsePublicKeyAlgorithm = response.getPublicKeyAlgorithm();
        } catch (error) {
          warnOnBrokenImplementation("getPublicKeyAlgorithm()", error);
        }
      }
      let responsePublicKey = void 0;
      if (typeof response.getPublicKey === "function") {
        try {
          const _publicKey = response.getPublicKey();
          if (_publicKey !== null) {
            responsePublicKey = (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(_publicKey);
          }
        } catch (error) {
          warnOnBrokenImplementation("getPublicKey()", error);
        }
      }
      let responseAuthenticatorData;
      if (typeof response.getAuthenticatorData === "function") {
        try {
          responseAuthenticatorData = (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.getAuthenticatorData());
        } catch (error) {
          warnOnBrokenImplementation("getAuthenticatorData()", error);
        }
      }
      return {
        id,
        rawId: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(rawId),
        response: {
          attestationObject: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.attestationObject),
          clientDataJSON: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.clientDataJSON),
          transports,
          publicKeyAlgorithm: responsePublicKeyAlgorithm,
          publicKey: responsePublicKey,
          authenticatorData: responseAuthenticatorData
        },
        type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: (0, toAuthenticatorAttachment_js_1.toAuthenticatorAttachment)(credential.authenticatorAttachment)
      };
    }
    function warnOnBrokenImplementation(methodName, cause) {
      console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${methodName}. You should report this error to them.
`, cause);
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/browserSupportsWebAuthnAutofill.js
var require_browserSupportsWebAuthnAutofill = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/browserSupportsWebAuthnAutofill.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2._browserSupportsWebAuthnAutofillInternals = void 0;
    exports2.browserSupportsWebAuthnAutofill = browserSupportsWebAuthnAutofill;
    var browserSupportsWebAuthn_js_1 = require_browserSupportsWebAuthn();
    function browserSupportsWebAuthnAutofill() {
      if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        return exports2._browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
      }
      const globalPublicKeyCredential = globalThis.PublicKeyCredential;
      if (globalPublicKeyCredential?.isConditionalMediationAvailable === void 0) {
        return exports2._browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
      }
      return exports2._browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
    }
    exports2._browserSupportsWebAuthnAutofillInternals = {
      stubThis: (value) => value
    };
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/identifyAuthenticationError.js
var require_identifyAuthenticationError = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/identifyAuthenticationError.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.identifyAuthenticationError = identifyAuthenticationError;
    var isValidDomain_js_1 = require_isValidDomain();
    var webAuthnError_js_1 = require_webAuthnError();
    function identifyAuthenticationError({ error, options }) {
      const { publicKey } = options;
      if (!publicKey) {
        throw Error("options was missing required publicKey property");
      }
      if (error.name === "AbortError") {
        if (options.signal instanceof AbortSignal) {
          return new webAuthnError_js_1.WebAuthnError({
            message: "Authentication ceremony was sent an abort signal",
            code: "ERROR_CEREMONY_ABORTED",
            cause: error
          });
        }
      } else if (error.name === "NotAllowedError") {
        return new webAuthnError_js_1.WebAuthnError({
          message: error.message,
          code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
          cause: error
        });
      } else if (error.name === "SecurityError") {
        const effectiveDomain = globalThis.location.hostname;
        if (!(0, isValidDomain_js_1.isValidDomain)(effectiveDomain)) {
          return new webAuthnError_js_1.WebAuthnError({
            message: `${globalThis.location.hostname} is an invalid domain`,
            code: "ERROR_INVALID_DOMAIN",
            cause: error
          });
        } else if (publicKey.rpId !== effectiveDomain) {
          return new webAuthnError_js_1.WebAuthnError({
            message: `The RP ID "${publicKey.rpId}" is invalid for this domain`,
            code: "ERROR_INVALID_RP_ID",
            cause: error
          });
        }
      } else if (error.name === "UnknownError") {
        return new webAuthnError_js_1.WebAuthnError({
          message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
          code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
          cause: error
        });
      }
      return error;
    }
  }
});

// node_modules/@simplewebauthn/browser/script/methods/startAuthentication.js
var require_startAuthentication = __commonJS({
  "node_modules/@simplewebauthn/browser/script/methods/startAuthentication.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.startAuthentication = startAuthentication;
    var bufferToBase64URLString_js_1 = require_bufferToBase64URLString();
    var base64URLStringToBuffer_js_1 = require_base64URLStringToBuffer();
    var browserSupportsWebAuthn_js_1 = require_browserSupportsWebAuthn();
    var browserSupportsWebAuthnAutofill_js_1 = require_browserSupportsWebAuthnAutofill();
    var toPublicKeyCredentialDescriptor_js_1 = require_toPublicKeyCredentialDescriptor();
    var identifyAuthenticationError_js_1 = require_identifyAuthenticationError();
    var webAuthnAbortService_js_1 = require_webAuthnAbortService();
    var toAuthenticatorAttachment_js_1 = require_toAuthenticatorAttachment();
    async function startAuthentication(options) {
      if (!options.optionsJSON && options.challenge) {
        console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
        options = { optionsJSON: options };
      }
      const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true } = options;
      if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        throw new Error("WebAuthn is not supported in this browser");
      }
      let allowCredentials;
      if (optionsJSON.allowCredentials?.length !== 0) {
        allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor_js_1.toPublicKeyCredentialDescriptor);
      }
      const publicKey = {
        ...optionsJSON,
        challenge: (0, base64URLStringToBuffer_js_1.base64URLStringToBuffer)(optionsJSON.challenge),
        allowCredentials
      };
      const getOptions = {};
      if (useBrowserAutofill) {
        if (!await (0, browserSupportsWebAuthnAutofill_js_1.browserSupportsWebAuthnAutofill)()) {
          throw Error("Browser does not support WebAuthn autofill");
        }
        const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
        if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
          throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
        }
        getOptions.mediation = "conditional";
        publicKey.allowCredentials = [];
      }
      getOptions.publicKey = publicKey;
      getOptions.signal = webAuthnAbortService_js_1.WebAuthnAbortService.createNewAbortSignal();
      let credential;
      try {
        credential = await navigator.credentials.get(
          // TODO: Newer versions of Deno require this casting, revisit once we're using Deno 2.6+
          getOptions
        );
      } catch (err) {
        throw (0, identifyAuthenticationError_js_1.identifyAuthenticationError)({ error: err, options: getOptions });
      }
      if (!credential) {
        throw new Error("Authentication was not completed");
      }
      const { id, rawId, response, type } = credential;
      let userHandle = void 0;
      if (response.userHandle) {
        userHandle = (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.userHandle);
      }
      return {
        id,
        rawId: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(rawId),
        response: {
          authenticatorData: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.authenticatorData),
          clientDataJSON: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.clientDataJSON),
          signature: (0, bufferToBase64URLString_js_1.bufferToBase64URLString)(response.signature),
          userHandle
        },
        type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: (0, toAuthenticatorAttachment_js_1.toAuthenticatorAttachment)(credential.authenticatorAttachment)
      };
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/identifySignalError.js
var require_identifySignalError = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/identifySignalError.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.identifySignalError = identifySignalError;
    var isValidDomain_js_1 = require_isValidDomain();
    var webAuthnError_js_1 = require_webAuthnError();
    function identifySignalError({ error, options }) {
      if (error.name === "SecurityError") {
        const effectiveDomain = globalThis.location.hostname;
        if (!(0, isValidDomain_js_1.isValidDomain)(effectiveDomain)) {
          return new webAuthnError_js_1.WebAuthnError({
            message: `"${globalThis.location.hostname}" is an invalid domain`,
            code: "ERROR_INVALID_DOMAIN",
            cause: error
          });
        }
        return new webAuthnError_js_1.WebAuthnError({
          message: `The browser does not support Related Origins to enable signals for RP ID "${options.rpID}" on domain "${globalThis.location.hostname}"`,
          code: "ERROR_INVALID_RP_ID",
          cause: error
        });
      }
      if (options.signalName === "unknownCredential") {
        if (error.name === "TypeError") {
          return new webAuthnError_js_1.WebAuthnError({
            message: "credentialID is an invalid base64url string",
            code: "ERROR_SIGNAL_INVALID_ARGUMENT",
            cause: error
          });
        }
      } else if (options.signalName === "allAcceptedCredentials") {
        if (error.name === "TypeError") {
          return new webAuthnError_js_1.WebAuthnError({
            message: "userID, or an entry in allAcceptedCredentialIDs, is an invalid base64url string",
            code: "ERROR_SIGNAL_INVALID_ARGUMENT",
            cause: error
          });
        }
      } else if (options.signalName === "currentUserDetails") {
        if (error.name === "TypeError") {
          return new webAuthnError_js_1.WebAuthnError({
            message: "userID is an invalid base64url string",
            code: "ERROR_SIGNAL_INVALID_ARGUMENT",
            cause: error
          });
        }
      }
      return new webAuthnError_js_1.WebAuthnError({
        message: error.message,
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: error
      });
    }
  }
});

// node_modules/@simplewebauthn/browser/script/methods/sendSignal.js
var require_sendSignal = __commonJS({
  "node_modules/@simplewebauthn/browser/script/methods/sendSignal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.sendSignal = sendSignal;
    var identifySignalError_js_1 = require_identifySignalError();
    async function sendSignal(opts) {
      const { signalName } = opts;
      if (signalName === "unknownCredential") {
        return _callSignalUnknownCredential(opts);
      } else if (signalName === "allAcceptedCredentials") {
        return _callSignalAllAcceptedCredentials(opts);
      } else if (signalName === "currentUserDetails") {
        return _callSignalCurrentUserDetails(opts);
      }
      throw new Error(`Received unrecognized signalName "${opts.signalName}"`);
    }
    async function _callSignalUnknownCredential(opts) {
      const globalPublicKeyCredential = globalThis.PublicKeyCredential;
      if (typeof globalPublicKeyCredential.signalUnknownCredential !== "function") {
        throw new Error("This browser does not support PublicKeyCredential.signalUnknownCredential()");
      }
      try {
        await globalPublicKeyCredential.signalUnknownCredential({
          rpId: opts.rpID,
          credentialId: opts.credentialID
        });
      } catch (err) {
        throw (0, identifySignalError_js_1.identifySignalError)({ error: err, options: opts });
      }
      return void 0;
    }
    async function _callSignalAllAcceptedCredentials(opts) {
      const globalPublicKeyCredential = globalThis.PublicKeyCredential;
      if (typeof globalPublicKeyCredential.signalAllAcceptedCredentials !== "function") {
        throw new Error("This browser does not support PublicKeyCredential.signalAllAcceptedCredentials()");
      }
      try {
        await globalPublicKeyCredential.signalAllAcceptedCredentials({
          rpId: opts.rpID,
          userId: opts.userID,
          allAcceptedCredentialIds: opts.allAcceptedCredentialIDs
        });
      } catch (err) {
        throw (0, identifySignalError_js_1.identifySignalError)({ error: err, options: opts });
      }
      return void 0;
    }
    async function _callSignalCurrentUserDetails(opts) {
      const globalPublicKeyCredential = globalThis.PublicKeyCredential;
      if (typeof globalPublicKeyCredential.signalCurrentUserDetails !== "function") {
        throw new Error("This browser does not support PublicKeyCredential.signalCurrentUserDetails()");
      }
      try {
        await globalPublicKeyCredential.signalCurrentUserDetails({
          rpId: opts.rpID,
          userId: opts.userID,
          name: opts.userName,
          displayName: opts.userDisplayName ?? ""
        });
      } catch (err) {
        throw (0, identifySignalError_js_1.identifySignalError)({ error: err, options: opts });
      }
      return void 0;
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/getBrowserCapabilities.js
var require_getBrowserCapabilities = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/getBrowserCapabilities.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2._getBrowserCapabilitiesInternals = void 0;
    exports2.getBrowserCapabilities = getBrowserCapabilities;
    async function getBrowserCapabilities() {
      if (typeof PublicKeyCredential.getClientCapabilities === "function") {
        const capabilities = await PublicKeyCredential.getClientCapabilities();
        let _userVerifyingPlatformAuthenticator = mapCapabilityToEnum(capabilities.userVerifyingPlatformAuthenticator);
        if (_userVerifyingPlatformAuthenticator === "unknown" && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
          const isUVPAA = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          if (isUVPAA) {
            _userVerifyingPlatformAuthenticator = "supported";
          } else {
            _userVerifyingPlatformAuthenticator = "unsupported";
          }
        }
        let _conditionalGet = mapCapabilityToEnum(capabilities.conditionalGet);
        if (_conditionalGet === "unknown" && typeof PublicKeyCredential.isConditionalMediationAvailable === "function") {
          const isCMA = await PublicKeyCredential.isConditionalMediationAvailable();
          if (isCMA) {
            _conditionalGet = "supported";
          } else {
            _conditionalGet = "unsupported";
          }
        }
        return exports2._getBrowserCapabilitiesInternals.stubThis({
          conditionalCreate: mapCapabilityToEnum(capabilities.conditionalCreate),
          conditionalGet: _conditionalGet,
          hybridTransport: mapCapabilityToEnum(capabilities.hybridTransport),
          passkeyPlatformAuthenticator: mapCapabilityToEnum(capabilities.passkeyPlatformAuthenticator),
          userVerifyingPlatformAuthenticator: _userVerifyingPlatformAuthenticator,
          relatedOrigins: mapCapabilityToEnum(capabilities.relatedOrigins),
          signalAllAcceptedCredentials: mapCapabilityToEnum(capabilities.signalAllAcceptedCredentials),
          signalCurrentUserDetails: mapCapabilityToEnum(capabilities.signalCurrentUserDetails),
          signalUnknownCredential: mapCapabilityToEnum(capabilities.signalUnknownCredential)
        });
      }
      return exports2._getBrowserCapabilitiesInternals.stubThis({
        conditionalCreate: "unknown",
        conditionalGet: "unknown",
        hybridTransport: "unknown",
        passkeyPlatformAuthenticator: "unknown",
        userVerifyingPlatformAuthenticator: "unknown",
        relatedOrigins: "unknown",
        signalAllAcceptedCredentials: "unknown",
        signalCurrentUserDetails: "unknown",
        signalUnknownCredential: "unknown"
      });
    }
    function mapCapabilityToEnum(value) {
      if (value === true) {
        return "supported";
      } else if (value === false) {
        return "unsupported";
      } else if (typeof value === "undefined") {
        return "unknown";
      } else {
        throw new Error("Unexpected capability value:", value);
      }
    }
    exports2._getBrowserCapabilitiesInternals = {
      stubThis: (value) => value
    };
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/browserSupportsPasskeys.js
var require_browserSupportsPasskeys = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/browserSupportsPasskeys.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.browserSupportsPasskeys = browserSupportsPasskeys;
    var browserSupportsWebAuthn_js_1 = require_browserSupportsWebAuthn();
    var getBrowserCapabilities_js_1 = require_getBrowserCapabilities();
    async function browserSupportsPasskeys() {
      if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        return new Promise((resolve) => resolve(false));
      }
      const capabilities = await (0, getBrowserCapabilities_js_1.getBrowserCapabilities)();
      const { passkeyPlatformAuthenticator, userVerifyingPlatformAuthenticator, hybridTransport } = capabilities;
      return passkeyPlatformAuthenticator === "supported" || hybridTransport === "supported" || userVerifyingPlatformAuthenticator === "supported";
    }
  }
});

// node_modules/@simplewebauthn/browser/script/helpers/platformAuthenticatorIsAvailable.js
var require_platformAuthenticatorIsAvailable = __commonJS({
  "node_modules/@simplewebauthn/browser/script/helpers/platformAuthenticatorIsAvailable.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.platformAuthenticatorIsAvailable = platformAuthenticatorIsAvailable;
    var browserSupportsWebAuthn_js_1 = require_browserSupportsWebAuthn();
    function platformAuthenticatorIsAvailable() {
      if (!(0, browserSupportsWebAuthn_js_1.browserSupportsWebAuthn)()) {
        return new Promise((resolve) => resolve(false));
      }
      return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  }
});

// node_modules/@simplewebauthn/browser/script/types/index.js
var require_types = __commonJS({
  "node_modules/@simplewebauthn/browser/script/types/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
  }
});

// node_modules/@simplewebauthn/browser/script/index.js
var require_script = __commonJS({
  "node_modules/@simplewebauthn/browser/script/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_startRegistration(), exports2);
    __exportStar(require_startAuthentication(), exports2);
    __exportStar(require_sendSignal(), exports2);
    __exportStar(require_browserSupportsWebAuthn(), exports2);
    __exportStar(require_browserSupportsPasskeys(), exports2);
    __exportStar(require_platformAuthenticatorIsAvailable(), exports2);
    __exportStar(require_browserSupportsWebAuthnAutofill(), exports2);
    __exportStar(require_base64URLStringToBuffer(), exports2);
    __exportStar(require_bufferToBase64URLString(), exports2);
    __exportStar(require_getBrowserCapabilities(), exports2);
    __exportStar(require_webAuthnAbortService(), exports2);
    __exportStar(require_webAuthnError(), exports2);
    __exportStar(require_types(), exports2);
  }
});

// src/i18n-phrases.ts
var PHRASES = [
  // ===== 通用 =====
  ["解锁", "Unlock"],
  ["添加", "Add"],
  ["删除", "Delete"],
  ["取消", "Cancel"],
  ["确认", "Confirm"],
  ["保存", "Save"],
  ["重命名", "Rename"],
  ["启用", "Enable"],
  ["停用", "Disable"],
  ["安装", "Install"],
  ["卸载", "Uninstall"],
  ["更新", "Update"],
  ["升级", "Upgrade"],
  ["重载", "Reload"],
  ["禁用", "Disable"],
  ["撤销", "Revoke"],
  ["拒绝", "Reject"],
  ["是", "Yes"],
  ["否", "No"],
  ["管理", "Admin"],
  ["管理员", "Administrator"],
  ["用户", "User"],
  ["普通用户", "User"],
  ["类型", "Type"],
  ["角色", "Role"],
  ["操作", "Actions"],
  ["创建者", "Created by"],
  ["剩余", "Remaining"],
  ["加载中…", "Loading…"],
  ["验证中…", "Verifying…"],
  ["未命名", "Untitled"],
  ["未命名配置", "Untitled profile"],
  ["暂无用量", "No usage yet"],
  ["暂无邀请码", "No invite codes yet"],
  ["未使用", "Unused"],
  ["已备份", "Backed up"],
  ["可同步", "Synced"],
  ["仅此设备", "This device only"],
  // ===== 登录页 =====
  ["请登录后继续访问", "Sign in to continue"],
  ["用户名", "Username"],
  ["密码", "Password"],
  ["动态码（可选）", "Code (optional)"],
  ["已启用两步验证时填写 6 位动态码", "Enter the 6-digit code if 2FA is enabled"],
  ["登 录", "Sign in"],
  ["或", "or"],
  ["🔑 使用通行密钥登录", "🔑 Sign in with a passkey"],
  ["也可使用已绑定的通行密钥（指纹 / 面容 / 设备 PIN，或手机扫码）", "Or use a bound passkey (fingerprint / face / device PIN, or scan with your phone)"],
  ["访问受保护 · ", "Protected access · "],
  ["注册账号", "Create account"],
  ["显示/隐藏密码", "Show or hide password"],
  ["该账号已启用两步验证，请输入验证器中的 6 位动态码后再次登录", "This account uses two-step verification — enter the 6-digit code from your authenticator and sign in again"],
  ["该账号已开启两步验证，请使用通行密钥完成第二步验证…", "This account uses two-step verification — complete the second step with your passkey…"],
  ["登录失败 (", "Sign-in failed ("],
  ["网络错误，请重试", "Network error, please retry"],
  ["已取消或该设备没有可用的通行密钥", "Cancelled, or this device has no usable passkey"],
  ["当前浏览器不支持通行密钥", "This browser does not support passkeys"],
  // ===== 注册页 =====
  ["注册新账号（需要有效邀请码）", "Create an account (a valid invite code is required)"],
  ["邮箱", "Email"],
  ["邀请码", "Invite code"],
  ["确认密码", "Confirm password"],
  ["注 册", "Create account"],
  ["已有账号？返回登录", "Already registered? Sign in"],
  ["密码不满足强度要求（至少 8 位且含两种字符类型）", "The password does not meet the requirement (8+ characters, two classes)"],
  ["两次输入的密码不一致", "The two passwords do not match"],
  ["至少 8 位且含两种字符类型（大小写字母/数字/符号）", "At least 8 characters with two classes (upper, lower, digit, symbol)"],
  ["密码强度：", "Password strength: "],
  ["注册失败 (", "Registration failed ("],
  ["新用户注册必须输入有效邀请码；每个码可按设置的可注册次数使用。", "Registration requires a valid invite code; each code can be used as many times as configured."],
  // ===== 注册成功引导页 =====
  ["注册成功，欢迎 ", "Welcome, "],
  ["建议现在为账号添加", "Consider adding a"],
  ["第二个登录因子", "second sign-in factor"],
  ["，二选一（也可以两个都加）：", " now — pick one, or add both:"],
  ["TOTP 动态码", "TOTP code"],
  ["通行密钥", "Passkey"],
  ["：用 Google Authenticator / Microsoft Authenticator 等验证器 App 扫码，用下方按钮开始；", ": scan the code with an authenticator app such as Google Authenticator or Microsoft Authenticator, then use the button below."],
  ["：用指纹 / 面容 / 设备 PIN 直接登录。登录后到【设置】→【用户管理】→「通行密钥（Passkey）」添加本机密钥，或用手机扫码添加。", ": sign in with fingerprint, face or device PIN. After signing in, add one under Settings → User management → Passkey, or scan with your phone."],
  ["立即添加 TOTP 令牌", "Add a TOTP token now"],
  ["稍后再说，进入首页", "Skip for now"],
  ["启用两步验证", "Enable two-step verification"],
  ["绑定任一因子后，可在【用户管理】→「两步验证」开关启用两步验证；也可以跳过此步稍后再设置。", "Once a factor is bound you can switch two-step verification on under User management; you can also skip this and set it up later."],
  ["密钥（无法扫码时手动输入）", "Secret (type manually if you cannot scan)"],
  ["验证器中的 6 位动态码", "6-digit code from the authenticator"],
  ["输入验证器中的 6 位动态码以启用", "Enter the 6-digit code from your authenticator to enable"],
  ["请输入 6 位动态验证码", "Enter the 6-digit code"],
  ["验证码不正确", "Incorrect code"],
  ["TOTP 已启用", "TOTP enabled"],
  ["生成失败 (", "Generation failed ("],
  ["验证失败 (", "Verification failed ("],
  // ===== 用户管理：账号与改密 =====
  ["用户管理", "User management"],
  ["我的账号", "My account"],
  ["当前登录：", "Signed in as: "],
  ["昵称（显示名）", "Display name"],
  ["保存个人信息", "Save profile"],
  ["退出登录", "Sign out"],
  ["个人信息已保存", "Profile saved"],
  ["（我）", " (me)"],
  ["当前密码", "Current password"],
  ["新密码（至少 8 位，含两种字符类型）", "New password (8+ characters, two classes)"],
  ["确认新密码", "Confirm new password"],
  ["修改密码", "Change password"],
  ["当前密码正确，已解锁下面的输入框", "Current password correct — the fields below are unlocked"],
  ["当前密码不正确，下面的输入框保持锁定", "Current password incorrect — the fields below stay locked"],
  ["离开此输入框时会自动校验；校验通过前下面两个输入框锁定", "Leaving this field verifies it; the two fields below stay locked until it passes"],
  ["强度很高", "strong"],
  ["刚满足要求（建议再加长或混合更多字符类型）", "just meets the requirement (longer or more varied is better)"],
  ["不满足要求（至少 8 位且含两类字符）", "not sufficient (at least 8 characters and two classes)"],
  ["两次输入一致", "Both entries match"],
  ["两次输入不一致", "The two entries differ"],
  ["新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）", "The new password needs 8+ characters and at least two classes (upper, lower, digit, symbol)"],
  ["两次输入的新密码不一致", "The two new passwords do not match"],
  ["密码已修改（其他设备上的登录已失效）", "Password changed (sessions on other devices are now invalid)"],
  ["请输入当前密码", "Enter your current password"],
  ["当前密码不正确", "Current password is incorrect"],
  // ===== 用户管理：两步验证（TOTP） =====
  ["两步验证", "Two-step verification"],
  ["两步验证（TOTP）", "Two-step verification (TOTP)"],
  ["两步验证已开启", "Two-step verification is on"],
  ["已启用 TOTP", "TOTP enabled"],
  ["未启用 TOTP", "TOTP not enabled"],
  ["未绑定 TOTP", "TOTP not bound"],
  ["已绑定 TOTP", "TOTP bound"],
  ["已绑定 ", "Bound "],
  ["未绑定", "Not bound"],
  ["已启用两步验证（登录需密码 + 动态码）", "Two-step verification on (sign-in needs password + code)"],
  ["已启用两步验证（登录需密码 + 通行密钥）", "Two-step verification on (sign-in needs password + passkey)"],
  ["已关闭两步验证（登录仅需密码，通行密钥仍可直接登录）", "Two-step verification off (sign-in needs only the password; passkeys still work)"],
  ["未启用两步验证（登录仅需密码）", "Two-step verification off (sign-in needs only the password)"],
  ["开启后登录需要第二个因子：已绑定 TOTP 时用动态码，否则用通行密钥。", "When on, signing in needs a second factor: the TOTP code if bound, otherwise a passkey."],
  ["关闭后仅凭密码即可登录（通行密钥仍可直接登录）；开启状态下改动通行密钥需要先通过二次验证。", "When off, the password alone signs you in (passkeys still work); while on, changing passkeys first requires a second-step check."],
  ["生成 TOTP 密钥", "Generate TOTP secret"],
  ["移除 TOTP", "Remove TOTP"],
  ["TOTP 密钥已生成，请用验证器扫码或手动输入后输入 6 位动态码启用", "TOTP secret generated — scan it with your authenticator or enter it manually, then type the 6-digit code to enable"],
  ["使用 Google Authenticator / Microsoft Authenticator 等应用，通过 otpauth 链接或手动输入密钥添加本账号；启用后每次登录输入 6 位动态码。", "Add this account in an app such as Google Authenticator or Microsoft Authenticator via the otpauth link or by typing the secret; after enabling, sign-in asks for a 6-digit code."],
  ["用验证器扫描二维码添加（Google Authenticator / Microsoft Authenticator 等）", "Scan the QR code with your authenticator (Google Authenticator, Microsoft Authenticator, …)"],
  ["otpauth 链接", "otpauth link"],
  ["TOTP 二维码", "TOTP QR code"],
  ["已启用 TOTP，如需更换请先移除现有令牌", "TOTP is already enabled — remove the existing token before replacing it"],
  ["确定移除 TOTP 令牌？移除后两步验证将由通行密钥完成（登录需「密码 + 通行密钥」）。", "Remove the TOTP token? Two-step verification will then rely on a passkey (sign-in needs password + passkey)."],
  ["确定移除 TOTP 令牌？移除后两步验证会自动关闭，登录仅需密码。", "Remove the TOTP token? Two-step verification will switch off and sign-in will need only the password."],
  ["请输入当前 6 位动态验证码以确认移除", "Enter the current 6-digit code to confirm removal"],
  ["移除令牌需输入当前 6 位动态码", "Removing the token requires the current 6-digit code"],
  ["TOTP 已移除", "TOTP removed"],
  ["请先生成 TOTP 密钥", "Generate a TOTP secret first"],
  ["当前账号没有 TOTP 令牌，两步验证由通行密钥完成。如需改用动态码，可在下方生成并绑定 TOTP。", "This account has no TOTP token; two-step verification uses a passkey. To switch to codes, generate and bind TOTP below."],
  ["请先绑定 TOTP 令牌或添加通行密钥，再开启两步验证", "Bind a TOTP token or add a passkey before enabling two-step verification"],
  ["6 位动态码", "6-digit code"],
  // ===== 用户管理：通行密钥 =====
  ["通行密钥（Passkey）", "Passkey"],
  ["添加通行密钥", "Add passkey"],
  ["重命名通行密钥", "Rename passkey"],
  ["删除通行密钥", "Delete passkey"],
  ["＋ 本机通行密钥", "＋ This device"],
  ["📱 手机扫码添加", "📱 Scan with phone"],
  ["名称（可选，便于区分设备）", "Name (optional, to tell devices apart)"],
  ["例如：我的笔记本 / iPhone", "e.g. My laptop / iPhone"],
  ["用指纹 / 面容 / 设备 PIN 代替密码登录。私钥永不离开设备，服务器只保存公钥；一个账号可以绑定多个（本机设备、多台手机）。", "Use fingerprint, face or device PIN instead of a password. The private key never leaves your device; the server stores only the public key. An account can bind several (this device, more than one phone)."],
  ["「本机通行密钥」使用这台电脑的指纹 / 面容 / Windows Hello；「手机扫码添加」由浏览器显示二维码，用手机相机扫码后在本机完成绑定（手机无需与电脑处于同一网络）。", "This device uses your computer fingerprint, face or Windows Hello; Scan with phone shows a QR code that your phone camera reads, and the binding finishes on this computer (the phone does not need to share its network)."],
  ["通行密钥已添加", "Passkey added"],
  ["通行密钥已重命名", "Passkey renamed"],
  ["通行密钥已删除", "Passkey deleted"],
  ["该通行密钥已绑定", "That passkey is already bound"],
  ["删除通行密钥「", 'Delete the passkey "'],
  ["」？删除后该设备将无法再用它登录。", '"? That device will no longer be able to sign in with it.'],
  ["为这个通行密钥设置新名称：", "New name for this passkey:"],
  ["通行密钥 ", "Passkey "],
  ["· 最近使用：", "· last used: "],
  ["当前地址无法使用通行密钥", "Passkeys are unavailable at this address"],
  ["当前访问地址无法使用通行密钥。", "Passkeys cannot be used at the current address."],
  ["请改用 http://", "Use http://"],
  ["通行密钥可以代替密码登录，因此改动前必须确认是你本人。", "A passkey can sign you in instead of a password, so confirm it is you before changing it."],
  ["确认身份 · ", "Confirm identity · "],
  ["该账号的第二步验证是通行密钥：提交密码后会再要求你完成一次通行密钥验证。", "This account uses a passkey as the second step: after the password you will be asked to complete one passkey check."],
  ["通行密钥脚本不可用", "The passkey helper script is unavailable"],
  ["未找到可用的通行密钥", "No usable passkey was found"],
  ["该账号没有可用的通行密钥", "This account has no usable passkey"],
  ["该账号没有可用的通行密钥，请改用其他验证方式", "This account has no usable passkey — use another verification method"],
  ["该账号已开启两步验证且仅剩这一个通行密钥：请先绑定 TOTP 令牌，或先关闭两步验证", "Two-step verification is on and this is the only passkey: bind a TOTP token first, or switch two-step verification off"],
  ["通行密钥不存在", "Passkey not found"],
  ["通行密钥与账号不匹配", "The passkey does not belong to this account"],
  ["清除通行密钥", "Clear passkeys"],
  ["清除用户「", 'Clear every passkey of "'],
  ["」的全部通行密钥？该用户将无法再用通行密钥登录（用于设备丢失时的账号救援）。", '"? That user will no longer be able to sign in with a passkey (account rescue when a device is lost).'],
  ["该用户的通行密钥已清除", "That user passkeys were cleared"],
  // ===== 用户管理：用户表格与邀请码 =====
  ["昵称", "Display name"],
  ["已用 / 可注册", "Used / allowed"],
  ["创建用户", "Create user"],
  ["初始密码（至少 8 位，含两种字符类型）", "Initial password (8+ characters, two classes)"],
  ["初始密码至少 8 位且含两种及以上字符类型", "The initial password needs 8+ characters and at least two classes"],
  ["密码仅本次设置，之后无法查看", "Set once, and not viewable later"],
  ["用户名仅允许 2-32 位字母、数字、下划线、点或短横线", "Usernames allow 2-32 letters, digits, underscore, dot or hyphen"],
  ["用户已创建", "User created"],
  ["用户已删除", "User deleted"],
  ["角色已更新", "Role updated"],
  ["确定删除用户「", 'Delete the user "'],
  ["」？该操作不可撤销。", '"? This cannot be undone.'],
  ["为用户「", 'Set a new password for "'],
  ["」设置新密码（至少 8 位，含两种字符类型）：", '" (8+ characters, two classes):'],
  ["密码已重置", "Password reset"],
  ["重置密码", "Reset password"],
  ["切换角色", "Change role"],
  ["将「", 'Change "'],
  ["」的角色改为「", '" to "'],
  ["不能删除当前登录的账号", "You cannot delete the account you are signed in with"],
  ["不能删除最后一个管理员", "The last administrator cannot be deleted"],
  ["不能降级最后一个管理员", "The last administrator cannot be demoted"],
  ["说明：管理员可以新增、删除用户并重置密码，也可以在设备丢失时清除某个用户的通行密钥（用于账号救援），但无法查看任何人的当前密码。不能删除或降级最后一个管理员。", "Note: an administrator can add users, delete them, reset passwords and clear a user passkeys when a device is lost (account rescue), but cannot see anyone current password. The last administrator cannot be deleted or demoted."],
  ["邀请码管理（管理员）", "Invite codes"],
  ["生成邀请码", "Generate invite codes"],
  ["生成数量（1-50）", "How many (1-50)"],
  ["每个码可注册次数（1-100）", "Uses per code (1-100)"],
  ["生成数量需为 1-50", "The count must be between 1 and 50"],
  ["每个邀请码可用次数需为 1-100", "Uses per code must be between 1 and 100"],
  ["邀请码已生成", "Invite codes generated"],
  ["邀请码已撤销", "Invite code revoked"],
  ["撤销邀请码「", 'Revoke the invite code "'],
  ["」？已注册用户不受影响。", '"? Users who already registered are unaffected.'],
  // ===== 永久忽略提醒 =====
  ["永久忽略登录提醒", "Ignore the sign-in reminder permanently"],
  ["取消永久忽略", "Stop ignoring"],
  ["已永久忽略登录提醒", "Sign-in reminder permanently ignored"],
  ["已取消永久忽略", "No longer ignoring"],
  ["（已永久忽略登录提醒）", " (sign-in reminder permanently ignored)"],
  // ===== 通用提示 / 校验 =====
  ["请输入名称", "Enter a name"],
  ["存储未就绪", "Storage is not ready"],
  ["服务初始化中，请稍后重试", "The service is starting, please retry shortly"],
  ["未登录或会话已过期", "Not signed in, or the session expired"],
  ["未知方法", "Unknown method"],
  ["需要管理员权限", "Administrator permission required"],
  ["请求体格式错误", "Malformed request body"],
  ["用户名或密码错误", "Wrong username or password"],
  ["请输入用户名和密码", "Enter a username and password"],
  ["请输入邀请码", "Enter an invite code"],
  ["邀请码无效或已用完", "The invite code is invalid or exhausted"],
  ["邀请码不存在", "Invite code not found"],
  ["用户不存在", "User not found"],
  ["用户名已存在", "That username already exists"],
  ["账号不存在", "Account not found"],
  ["账号数据写入失败，请重试", "Could not save the account, please retry"],
  ["目标用户不存在", "The target user does not exist"],
  ["目标用户不存在或尚未分配配置标识", "The target user does not exist or has no profile identifier yet"],
  ["密码至少 ", "Password must be at least "],
  ["密码过长（最多 ", "Password too long (at most "],
  ["位）", " characters)"],
  ["6 位", "6 characters"],
  ["密码格式错误", "Malformed password"],
  ["密码不正确", "Wrong password"],
  ["原密码不正确", "The current password is incorrect"],
  ["口令不正确", "Wrong password"],
  ["密码需包含至少两种字符类型（大写字母、小写字母、数字、符号）", "The password must contain at least two classes (upper, lower, digit, symbol)"],
  ["尝试次数过多，请 ", "Too many attempts, please "],
  ["秒后再试", " seconds later"],
  ["尝试过于频繁，请稍后再试", "Too many attempts, please retry shortly"],
  ["次 / ", " × / "],
  ["已达上限 ", "Limit reached "],
  ["输入验证码", "Enter the code"],
  ["位）或任意 ", " characters) or any "],
  ["本次登录已失效，请重新输入密码", "That sign-in attempt expired, enter the password again"],
  ["本次验证不属于当前账号，请重新验证身份", "This verification belongs to another account, please verify again"],
  ["本次验证已失效，请重新验证身份", "This verification expired, please verify again"],
  ["来源地址已变化，请重新验证身份", "The origin changed, please verify again"],
  ["验证已超时，请重新验证身份", "Verification timed out, please verify again"],
  ["验证未完成", "Verification not completed"],
  ["请求失败 (", "Request failed ("],
  // ===== 模型与分享（键已用于客户端切片，这里补齐短语与消息） =====
  ["模型", "Model"],
  ["名称", "Name"],
  ["余额", "Balance"],
  ["默认", "Default"],
  ["查余额（全部配置）", "Check balance (all profiles)"],
  ["设为默认", "Set as default"],
  ["选用分享", "Use shared"],
  ["校验有效性", "Check key"],
  ["检查 Key", "Check key"],
  ["检查中…", "Checking…"],
  ["查询中…", "Querying…"],
  ["需先解锁", "Unlock required"],
  ["稍后重试", "Retry later"],
  ["不可用", "Unavailable"],
  ["未选择配置", "No profile selected"],
  ["管理员分享", "Shared by admin"],
  ["添加我自己的配置", "Add your own profile"],
  ["当前登录口令", "Current password"],
  ["用于解锁私人密钥（不保存）", "Unlocks your private keys (never stored)"],
  ["baseURL（留空用官方地址）", "baseURL (empty = official endpoint)"],
  ["分享名称", "Share name"],
  ["创建分享配置", "Create shared profile"],
  ["分享的 API Key：", "Shared API keys:"],
  ["分享配置", "Shared profile"],
  ["分享", "Share"],
  ["选择分享的 API Key", "Choose a shared API key"],
  ["用量：", "Usage: "],
  ["已授权用户", "Authorized users"],
  ["尚未授权给任何用户", "Not shared with anyone yet"],
  ["取消授权", "Revoke"],
  ["授予用户名", "Username to grant"],
  ["授予", "Grant"],
  ["还没有分享配置。", "No shared profiles yet."],
  ["已授权", "Authorized"],
  ["未授权", "Not authorized"],
  ["例如：共享 DeepSeek", "e.g. Shared DeepSeek"],
  ["例如：我的 DeepSeek", "e.g. My DeepSeek"],
  ["还没有配置。未配置时模型调用会被拒绝——不会回退到部署级配置。", "No profiles yet. Model calls are refused without one — there is no fallback to the deployment configuration."],
  ["这里的配置只属于你自己：其他用户（包括管理员）都无法查看你的 API Key。管理员分享给你的配置可以直接选用，能看到余额，但看不到 Key。", "These profiles belong to you alone: no other user (not even an administrator) can see your API keys. A profile an administrator shares can be selected directly — you see its balance, never its key."],
  ["把你的模型分享给指定用户：对方可以选用并查看余额，但看不到你的 API Key；撤销后立即失效。", "Share your model with specific users: they can select it and see its balance, but never your API key. Revoking takes effect immediately."],
  ["✔ 连通可用，余额 ", "✔ Reachable, balance "],
  ["✔ Key 可用，余额 ", "✔ Key works, balance "],
  ["✘ ", "✘ "],
  ["API Key 不能为空", "The API key cannot be empty"],
  ["无法验证：接口拒绝或网络不可达（请检查 Key 与 baseURL）", "Cannot verify: the endpoint refused or the network is unreachable (check the key and baseURL)"],
  ["当前部署未启用 Key 校验（缺少余额查询实现）", "Key verification is not enabled in this deployment (no balance implementation)"],
  ["分享不存在或未授予", "The share does not exist or was not granted"],
  ["分享配置不存在", "Shared profile not found"],
  ["分享配置不存在或已撤销", "The shared profile does not exist or was revoked"],
  ["配置不存在", "Profile not found"],
  ["配置不存在或缺少密文（需重新录入 Key）", "The profile is missing or has no sealed key (re-enter the key)"],
  ["会话未解锁：私有配置的密钥只在该用户会话内存中（请重新登录）", "Session locked: a private profile key lives only in that user session memory (sign in again)"],
  ["会话未解锁：请重新登录后再使用自己的模型配置", "Session locked: sign in again before using your own model profiles"],
  ["私有配置缺少 KDF 参数", "The private profile has no KDF parameters"],
  ["无法校验（用户记录不可用）", "Cannot verify (the user record is unavailable)"],
  ["拒绝跨用户读取模型配置（仅本人可读）", "Cross-user reads of model profiles are refused (owner only)"],
  // ===== 插件管理器只读提示 =====
  ["仅部署者可以安装、卸载或启停插件（服务端会拒绝该操作）", "Only the deployer can install, uninstall or toggle plugins (the server refuses it)"],
  // ===== 客户端其余 =====
  ["安全随机源不可用", "A secure random source is unavailable"],
  ["WebCrypto 不可用：无法进行配置密钥的加解密", "WebCrypto is unavailable: profile keys cannot be encrypted or decrypted"],
  ["不支持的 DSH 宿主", "Unsupported DSH host"],
  ["建议开启两步验证", "Turn on two-step verification"],
  ["稍后再说", "Later"],
  ["永久忽略", "Ignore permanently"],
  ["添加登录因子：TOTP 动态码令牌（Google Authenticator / Microsoft Authenticator 等）或通行密钥（指纹 / 面容 / 设备 PIN）。", "Add a sign-in factor: a TOTP token (Google Authenticator, Microsoft Authenticator, …) or a passkey (fingerprint, face, device PIN)."]
];

// src/i18n.ts
var DICTIONARY = {
  "dsh-ui-auth": {
    // —— 通用 ——
    "common.unlock": { zh: "解锁", en: "Unlock" },
    "common.add": { zh: "添加", en: "Add" },
    "common.remove": { zh: "删除", en: "Delete" },
    "common.cancel": { zh: "取消", en: "Cancel" },
    "common.save": { zh: "保存", en: "Save" },
    "common.balance": { zh: "查余额", en: "Balance" },
    "common.checkKey": { zh: "校验有效性", en: "Check key" },
    "common.checking": { zh: "校验中…", en: "Checking…" },
    "common.querying": { zh: "查询中…", en: "Querying…" },
    "common.notAvailable": { zh: "不可用", en: "Unavailable" },
    "common.later": { zh: "稍后重试", en: "Retry later" },
    "common.needUnlock": { zh: "需先解锁", en: "Unlock required" },
    "common.none": { zh: "—", en: "—" },
    "common.yes": { zh: "是", en: "Yes" },
    "common.no": { zh: "否", en: "No" },
    // —— 模型页 ——
    "models.title": { zh: "模型", en: "Models" },
    "models.intro": {
      zh: "这里的配置只属于你自己：其他用户（包括管理员）都无法查看你的 API Key。管理员分享给你的配置可以直接选用，能看到余额，但看不到 Key。",
      en: "These profiles belong to you alone: no other user (not even an administrator) can see your API keys. Profiles an administrator shares with you can be selected directly — you can see their balance, never their key."
    },
    "models.passwordLabel": { zh: "当前登录口令", en: "Current password" },
    "models.passwordPlaceholder": { zh: "用于解锁私人密钥（不保存）", en: "Unlocks your private keys (never stored)" },
    "models.balanceAll": { zh: "查余额（全部配置）", en: "Check balance (all profiles)" },
    "models.setDefault": { zh: "设为默认", en: "Set as default" },
    "models.useShare": { zh: "选用分享", en: "Use shared" },
    "models.colName": { zh: "名称", en: "Name" },
    "models.colModel": { zh: "模型", en: "Model" },
    "models.colKey": { zh: "API Key", en: "API key" },
    "models.colDefault": { zh: "默认", en: "Default" },
    "models.colBalance": { zh: "余额", en: "Balance" },
    "models.sharedByAdmin": { zh: "管理员分享", en: "Shared by admin" },
    "models.empty": {
      zh: "还没有配置。未配置时模型调用会被拒绝——不会回退到部署级配置。",
      en: "No profiles yet. Model calls are refused without one — there is no fallback to the deployment configuration."
    },
    "models.addTitle": { zh: "添加我自己的配置", en: "Add your own profile" },
    "models.fieldName": { zh: "名称", en: "Name" },
    "models.fieldModel": { zh: "模型", en: "Model" },
    "models.fieldBaseUrl": { zh: "baseURL（留空用官方地址）", en: "baseURL (empty = official endpoint)" },
    "models.fieldApiKey": { zh: "API Key", en: "API key" },
    "models.namePlaceholder": { zh: "例如：我的 DeepSeek", en: "e.g. My DeepSeek" },
    "models.keyOk": { zh: "✔ 连通可用，余额 {amount}", en: "✔ Reachable, balance {amount}" },
    "models.keyFail": { zh: "✘ {reason}", en: "✘ {reason}" },
    // —— 分享管理 ——
    "shares.title": { zh: "分享管理", en: "Sharing" },
    "shares.intro": {
      zh: "把你的模型分享给指定用户：对方可以选用并查看余额，但看不到你的 API Key；撤销后立即失效。",
      en: "Share your model with specific users: they can select it and see its balance, but never your API key. Revoking takes effect immediately."
    },
    "shares.fieldLabel": { zh: "分享名称", en: "Share name" },
    "shares.fieldModel": { zh: "模型", en: "Model" },
    "shares.fieldBaseUrl": { zh: "baseURL（留空用官方地址）", en: "baseURL (empty = official endpoint)" },
    "shares.fieldApiKey": { zh: "API Key", en: "API key" },
    "shares.create": { zh: "创建分享配置", en: "Create shared profile" },
    "shares.picker": { zh: "分享的 API Key：", en: "Shared API keys:" },
    "shares.usage": { zh: "用量：{value}", en: "Usage: {value}" },
    "shares.usageEmpty": { zh: "暂无用量", en: "No usage yet" },
    "shares.grantees": { zh: "已授权用户", en: "Authorized users" },
    "shares.noGrantees": { zh: "尚未授权给任何用户", en: "Not shared with anyone yet" },
    "shares.revoke": { zh: "取消授权", en: "Revoke" },
    "shares.grantPlaceholder": { zh: "授予用户名", en: "Username to grant" },
    "shares.grant": { zh: "授予", en: "Grant" },
    "shares.empty": { zh: "还没有分享配置。", en: "No shared profiles yet." },
    // —— 修改密码（引导式） ——
    "password.title": { zh: "修改密码", en: "Change password" },
    "password.current": { zh: "当前密码", en: "Current password" },
    "password.new": { zh: "新密码（至少 8 位，含两种字符类型）", en: "New password (8+ chars, two character classes)" },
    "password.confirm": { zh: "确认新密码", en: "Confirm new password" },
    "password.submit": { zh: "修改密码", en: "Change password" },
    "password.hintIdle": {
      zh: "离开此输入框时会自动校验；校验通过前下面两个输入框锁定",
      en: "Leaving this field verifies it; the two fields below stay locked until it passes"
    },
    "password.hintOk": { zh: "当前密码正确，已解锁下面的输入框", en: "Current password correct — the fields below are unlocked" },
    "password.hintBad": { zh: "当前密码不正确，下面的输入框保持锁定", en: "Current password incorrect — the fields below stay locked" },
    "password.strength": { zh: "密码强度：{value}", en: "Password strength: {value}" },
    "password.levelOk": { zh: "很高", en: "strong" },
    "password.levelWarn": { zh: "刚满足要求（建议再加长或混合更多字符类型）", en: "just meets the requirement (longer or more varied is better)" },
    "password.levelBad": { zh: "不满足要求（至少 8 位且含两类字符）", en: "not sufficient (at least 8 characters and two classes)" },
    "password.match": { zh: "两次输入一致", en: "Both entries match" },
    "password.mismatch": { zh: "两次输入不一致", en: "The two entries differ" }
  }
};
function message(locale, key, params) {
  const entry = DICTIONARY["dsh-ui-auth"][key];
  const template = entry === void 0 ? String(key) : locale === "en" ? entry.en : entry.zh;
  if (params === void 0) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
function normalizeLocale(tag) {
  if (typeof tag !== "string" || tag === "") return "en";
  return /^zh\b/i.test(tag) ? "zh" : "en";
}
function dictionaries() {
  const zh = {};
  const en = {};
  for (const [key, entry] of Object.entries(DICTIONARY["dsh-ui-auth"])) {
    zh[key] = entry.zh;
    en[key] = entry.en;
  }
  return { zh, en };
}
var ORDERED_PHRASES = PHRASES.filter(([zh, en]) => zh !== "" && en !== "" && zh !== en).slice().sort((a, b) => b[0].length - a[0].length);
function translatePhrase(locale, text) {
  if (locale !== "en" || text === "") return text;
  let result = text;
  for (const [zh, en] of ORDERED_PHRASES) {
    if (result.includes(zh)) result = result.split(zh).join(en);
  }
  return result;
}

// src/client.ts
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var React = require("react");
var SWA = require_script();
var AUTH_CSS = [
  ".dshua{display:flex;flex-direction:column;gap:18px;padding:4px 2px 18px;max-width:720px;color:var(--dsw-alias-label-primary)}",
  ".dshua h2{margin:0 0 10px;font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary)}",
  ".dshua .card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px 20px}",
  ".dshua .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
  ".dshua .grow{flex:1;min-width:180px}",
  ".dshua label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:10px 0 4px}",
  ".dshua input, .dshua select{padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font:inherit;outline:none;width:100%;box-sizing:border-box}",
  ".dshua input:focus, .dshua select:focus{border-color:var(--dsw-alias-brand-primary)}",
  ".dshua button{padding:8px 14px;border:0;border-radius:7px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:13px;font-weight:600;font:inherit;cursor:pointer}",
  ".dshua button:hover{background:var(--dsw-alias-button-primary-hover)}",
  ".dshua button.ghost{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
  ".dshua button.ghost:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-button-ghost-active-border)}",
  ".dshua button.danger{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}",
  ".dshua button.danger:hover{background:var(--dsw-alias-state-error-primary);opacity:.88}",
  ".dshua button:disabled{opacity:.55;cursor:default}",
  ".dshua .msg{font-size:13px;color:var(--dsw-alias-state-success-primary);min-height:16px}",
  ".dshua .err{font-size:13px;color:var(--dsw-alias-state-error-primary);min-height:16px}",
  ".dshua .meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:8px}",
  ".dshua table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;color:var(--dsw-alias-label-primary)}",
  ".dshua th, .dshua td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
  ".dshua th{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}",
  ".dshua .actions{display:flex;gap:6px}",
  ".dshua .badge{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;display:inline-block}",
  ".dshua .badge.admin{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);color:var(--dsw-alias-brand-primary)}",
  ".dshua .badge.user{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
  ".dshua .muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}",
  ".dshua .switch{position:relative;display:inline-flex;align-items:center;cursor:pointer;user-select:none;vertical-align:middle}",
  ".dshua .switch input{position:absolute;opacity:0;width:0;height:0}",
  ".dshua .switch .track{position:relative;width:40px;height:22px;border-radius:22px;background:var(--dsw-alias-interactive-bg-hover,#2a2f3a);transition:background .2s;flex-shrink:0}",
  ".dshua .switch .track .thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}",
  ".dshua .switch input:checked + .track{background:var(--dsw-alias-brand-primary,#4f7cff)}",
  ".dshua .switch input:checked + .track .thumb{transform:translateX(18px)}",
  ".dshua .switch input:disabled + .track{opacity:.55}",
  // —— 表格 / 工具条 / 字段：与「用户管理」页保持同一套排班（12px 标题、≥10px 横向、≥5px 纵向） ——
  ".dshua table{border-collapse:collapse;width:100%;margin:4px 0}",
  ".dshua th,.dshua td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:13px}",
  ".dshua th{color:var(--dsw-alias-label-secondary);font-weight:600}",
  ".dshua button{font-size:12px;padding:6px 12px;white-space:nowrap}",
  ".dshua .toolbar{display:flex;flex-wrap:wrap;gap:5px 10px;align-items:flex-end}",
  ".dshua .actions{display:flex;flex-wrap:wrap;gap:5px 10px;margin:10px 0 0}",
  ".dshua .field{display:flex;flex-direction:column;margin:0 0 10px;min-width:160px}",
  ".dshua .fields{display:flex;flex-direction:column}",
  ".dshua .fields .field{width:100%}",
  ".dshua .fields input{width:100%}",
  ".dshua .field.compact input{padding:4px 10px;font-size:12px;height:75%;min-height:24px}",
  ".dshua input.pw-ok,input.pw-ok:disabled{border-color:#2ecc71;box-shadow:0 0 6px 2px rgba(46,204,113,.35)}",
  ".dshua input.pw-warn,input.pw-warn:disabled{border-color:#f1c40f;box-shadow:0 0 6px 2px rgba(241,196,15,.35)}",
  ".dshua input.pw-bad,input.pw-bad:disabled{border-color:#e74c3c;box-shadow:0 0 6px 2px rgba(231,76,60,.35)}",
  ".dshua input.locked,input.locked:disabled{background:var(--dsw-alias-interactive-bg-hover);opacity:.72}",
  ".dshua .pw-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin:1px 0 8px}",
  ".dshua .field > label{margin:0 0 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
  ".dshua .muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}",
  ".dshua input,.dshua select{min-width:120px}"
].join("");
function injectAuthCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector('style[data-plugin-css="dsh-ui-auth"]') !== null) return;
  var tag = document.createElement("style");
  tag.dataset.plugin = "dsh-ui-auth";
  tag.dataset.pluginCss = "dsh-ui-auth";
  tag.textContent = AUTH_CSS;
  document.head.appendChild(tag);
}
function rpc(method, body) {
  return fetch("/auth/rpc/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(async (r) => {
    var j = {};
    try {
      j = await r.json();
    } catch (e) {
    }
    if (r.status === 401) {
      var p = encodeURIComponent(location.pathname + location.search);
      location.href = "/auth/login?next=" + p;
      var err = new Error("session-expired");
      err.code = "session-expired";
      throw err;
    }
    if (!r.ok || j.ok !== true) throw new Error(j.error || "请求失败 (" + r.status + ")");
    return j;
  });
}
function roleLabel(role) {
  return role === "admin" ? "管理" : "用户";
}
function AuthUsersPage() {
  var _s = React.useState, _e = React.useEffect;
  var meS = _s(null), me = meS[0], setMe = meS[1];
  var errS = _s(""), err = errS[0], setErr = errS[1];
  var msgS = _s(""), msg = msgS[0], setMsg = msgS[1];
  var busyS = _s(false), busy = busyS[0], setBusy = busyS[1];
  var pDisplayS = _s(""), pDisplay = pDisplayS[0], setPDisplay = pDisplayS[1];
  var pEmailS = _s(""), pEmail = pEmailS[0], setPEmail = pEmailS[1];
  function passwordLevel(value) {
    var classes = 0;
    if (/[a-z]/.test(value)) classes += 1;
    if (/[A-Z]/.test(value)) classes += 1;
    if (/[0-9]/.test(value)) classes += 1;
    if (/[^A-Za-z0-9]/.test(value)) classes += 1;
    if (value.length < 8 || classes < 2) return "bad";
    if (value.length >= 12 && classes >= 3) return "ok";
    return "warn";
  }
  function levelText(level) {
    return level === "ok" ? "强度很高" : level === "warn" ? "刚满足要求（建议再加长或混合更多字符类型）" : "不满足要求（至少 8 位且含两类字符）";
  }
  var oldPwS = _s(""), oldPw = oldPwS[0], setOldPw = oldPwS[1];
  var oldCheckS = _s("idle"), oldCheck = oldCheckS[0], setOldCheck = oldCheckS[1];
  var newPwS = _s(""), newPw = newPwS[0], setNewPw = newPwS[1];
  var newPw2S = _s(""), newPw2 = newPw2S[0], setNewPw2 = newPw2S[1];
  var usersS = _s([]), users = usersS[0], setUsers = usersS[1];
  var cNameS = _s(""), cName = cNameS[0], setCName = cNameS[1];
  var cPwS = _s(""), cPw = cPwS[0], setCPw = cPwS[1];
  var cRoleS = _s("user"), cRole = cRoleS[0], setCRole = cRoleS[1];
  var cDisplayS = _s(""), cDisplay = cDisplayS[0], setCDisplay = cDisplayS[1];
  var cEmailS = _s(""), cEmail = cEmailS[0], setCEmail = cEmailS[1];
  var usersVersionS = _s(0), usersVersion = usersVersionS[0], setUsersVersion = usersVersionS[1];
  var invitesS = _s([]), invites = invitesS[0], setInvites = invitesS[1];
  var iAmountS = _s("1"), iAmount = iAmountS[0], setIAmount = iAmountS[1];
  var iUsesS = _s("1"), iUses = iUsesS[0], setIUses = iUsesS[1];
  var invitesVersionS = _s(0), invitesVersion = invitesVersionS[0], setInvitesVersion = invitesVersionS[1];
  var totpS = _s({ enabled: false, ignore: false }), totp = totpS[0], setTotp = totpS[1];
  var tSecretS = _s(""), tSecret = tSecretS[0], setTSecret = tSecretS[1];
  var tOtpAuthS = _s(""), tOtpAuth = tOtpAuthS[0], setTOtpAuth = tOtpAuthS[1];
  var tQrUrlS = _s(""), tQrUrl = tQrUrlS[0], setTQrUrl = tQrUrlS[1];
  var tCodeS = _s(""), tCode = tCodeS[0], setTCode = tCodeS[1];
  var tRmCodeS = _s(""), tRmCode = tRmCodeS[0], setTRmCode = tRmCodeS[1];
  var pkS = _s({ loaded: false, list: [], twoFactor: false, totpBound: false, max: 20, rp: null });
  var pk = pkS[0];
  var setPk = pkS[1];
  var pkNameS = _s(""), pkName = pkNameS[0], setPkName = pkNameS[1];
  var suS = _s({ open: false, action: "", id: "", preferred: "", need: "", ticket: "", busy: false, error: "" });
  var su = suS[0];
  var setSu = suS[1];
  var suPwS = _s(""), suPw = suPwS[0], setSuPw = suPwS[1];
  var suCodeS = _s(""), suCode = suCodeS[0], setSuCode = suCodeS[1];
  var isAdmin = me !== null && me.role === "admin";
  _e(function() {
    var cancelled = false;
    rpc("me", {}).then(function(j) {
      if (cancelled) return;
      setMe(j.me);
      setPDisplay(j.me.displayName || "");
      setPEmail(j.me.email || "");
    }).catch(function(e) {
      if (e.code !== "session-expired" && !cancelled) setErr(e.message);
    });
    return function() {
      cancelled = true;
    };
  }, []);
  _e(function() {
    if (!isAdmin) return;
    var cancelled = false;
    rpc("listUsers", {}).then(function(j) {
      if (!cancelled) setUsers(j.users || []);
    }).catch(function(e) {
      if (e.code !== "session-expired" && !cancelled) setErr(e.message);
    });
    return function() {
      cancelled = true;
    };
  }, [isAdmin, usersVersion]);
  function refreshUsers() {
    setUsersVersion(function(v) {
      return v + 1;
    });
  }
  _e(function() {
    if (!isAdmin) return;
    var cancelled = false;
    rpc("inviteList", {}).then(function(j) {
      if (!cancelled) setInvites(j.invites || []);
    }).catch(function(e) {
      if (e.code !== "session-expired" && !cancelled) setErr(e.message);
    });
    return function() {
      cancelled = true;
    };
  }, [isAdmin, invitesVersion]);
  function refreshInvites() {
    setInvitesVersion(function(v) {
      return v + 1;
    });
  }
  function createInvites() {
    var amount = parseInt(iAmount, 10);
    var uses = parseInt(iUses, 10);
    if (!(amount >= 1 && amount <= 50)) {
      setErr("生成数量需为 1-50");
      return;
    }
    if (!(uses >= 1 && uses <= 100)) {
      setErr("每个邀请码可用次数需为 1-100");
      return;
    }
    run(function() {
      return rpc("inviteCreate", { amount, uses }).then(refreshInvites);
    }, "邀请码已生成");
  }
  function revokeInvite(code) {
    if (!window.confirm("撤销邀请码「" + code + "」？已注册用户不受影响。")) return;
    run(function() {
      return rpc("inviteRevoke", { code }).then(refreshInvites);
    }, "邀请码已撤销");
  }
  _e(function() {
    var cancelled = false;
    rpc("totpStatus", {}).then(function(j) {
      if (!cancelled) setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true });
    }).catch(function(e) {
      if (e.code !== "session-expired" && !cancelled) setErr(e.message);
    });
    return function() {
      cancelled = true;
    };
  }, [me === null ? null : me.username]);
  _e(function() {
    var cancelled = false;
    rpc("passkeyList", {}).then(function(j) {
      if (cancelled) return;
      setPk({
        loaded: true,
        list: j.passkeys || [],
        twoFactor: j.twoFactor === true,
        totpBound: j.totpBound === true,
        max: typeof j.max === "number" ? j.max : 20,
        rp: j.rp || null
      });
    }).catch(function(e) {
      if (e.code !== "session-expired" && !cancelled) setErr(e.message);
    });
    return function() {
      cancelled = true;
    };
  }, [me === null ? null : me.username]);
  function refreshTotp() {
    rpc("totpStatus", {}).then(function(j) {
      setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true });
      if (j.totp.enabled === true) {
        setTSecret("");
        setTOtpAuth("");
      }
    }).catch(function(e) {
      if (e.code !== "session-expired") setErr(e.message);
    });
  }
  function toggle2fa() {
    var turningOn = totp.twoFactor !== true;
    var onMsg = totp.enabled ? "已启用两步验证（登录需密码 + 动态码）" : "已启用两步验证（登录需密码 + 通行密钥）";
    run(
      function() {
        return rpc("totpSet2fa", { enabled: turningOn }).then(function() {
          refreshTotp();
          refreshPk();
        });
      },
      turningOn ? onMsg : "已关闭两步验证（登录仅需密码，通行密钥仍可直接登录）"
    );
  }
  function genTotp() {
    run(function() {
      return rpc("totpGenerate", {}).then(function(j) {
        setTSecret(j.secret);
        setTOtpAuth(j.otpauth);
        setTQrUrl(j.qrDataUrl || "");
        setTCode("");
        refreshTotp();
      });
    }, "TOTP 密钥已生成，请用验证器扫码或手动输入后输入 6 位动态码启用");
  }
  function enableTotp() {
    if (!/^\d{6}$/.test(tCode)) {
      setErr("请输入 6 位动态验证码");
      return;
    }
    run(function() {
      return rpc("totpVerify", { code: tCode }).then(refreshTotp);
    }, "TOTP 已启用");
  }
  function removeTotp() {
    var confirmText = pk.list.length > 0 ? "确定移除 TOTP 令牌？移除后两步验证将由通行密钥完成（登录需「密码 + 通行密钥」）。" : "确定移除 TOTP 令牌？移除后两步验证会自动关闭，登录仅需密码。";
    if (!window.confirm(confirmText)) return;
    if (!/^\d{6}$/.test(tRmCode)) {
      setErr("请输入当前 6 位动态验证码以确认移除");
      return;
    }
    run(function() {
      return rpc("totpRemove", { code: tRmCode }).then(function() {
        setTRmCode("");
        refreshTotp();
        refreshPk();
      });
    }, "TOTP 已移除");
  }
  function toggleIgnore() {
    run(function() {
      return rpc("totpIgnore", { ignore: !totp.ignore }).then(refreshTotp);
    }, totp.ignore ? "已取消永久忽略" : "已永久忽略登录提醒");
  }
  function suClosed() {
    return { open: false, action: "", id: "", label: "", preferred: "", need: "", ticket: "", busy: false, error: "" };
  }
  function refreshPk() {
    rpc("passkeyList", {}).then(function(j) {
      setPk({
        loaded: true,
        list: j.passkeys || [],
        twoFactor: j.twoFactor === true,
        totpBound: j.totpBound === true,
        max: typeof j.max === "number" ? j.max : 20,
        rp: j.rp || null
      });
    }).catch(function(e) {
      if (e.code !== "session-expired") setErr(e.message);
    });
  }
  function askStepUp(action, id, preferred, label) {
    setSuPw("");
    setSuCode("");
    setErr("");
    setMsg("");
    setSu({ open: true, action, id, label, preferred, need: "", ticket: "", busy: false, error: "" });
  }
  function stepUpError(e) {
    setSu(function(s) {
      return { ...s, busy: false, error: e && e.message ? e.message : "验证未完成" };
    });
  }
  function finishStepUp(ticket) {
    var action = su.action;
    if (action === "add") {
      return rpc("passkeyAddOptions", { ticket, preferred: su.preferred }).then(function(j) {
        if (typeof window.PublicKeyCredential === "undefined") throw new Error("当前浏览器不支持通行密钥");
        return SWA.startRegistration({ optionsJSON: j.options }).then(function(cred) {
          return rpc("passkeyAddVerify", { ticket, handle: j.handle, response: cred, label: su.label });
        });
      }).then(function() {
        setSu(suClosed());
        setMsg("通行密钥已添加");
        refreshPk();
        refreshTotp();
      }).catch(stepUpError);
    }
    if (action === "rename") {
      return rpc("passkeyRename", { ticket, id: su.id, label: su.label }).then(function() {
        setSu(suClosed());
        setMsg("通行密钥已重命名");
        refreshPk();
      }).catch(stepUpError);
    }
    if (action === "remove") {
      return rpc("passkeyRemove", { ticket, id: su.id }).then(function() {
        setSu(suClosed());
        setMsg("通行密钥已删除");
        refreshPk();
        refreshTotp();
      }).catch(stepUpError);
    }
    setSu(suClosed());
    return void 0;
  }
  function submitStepUp() {
    if (suPw === "") {
      setSu(function(s) {
        return { ...s, error: "请输入当前密码" };
      });
      return;
    }
    var password = suPw;
    var code = suCode;
    var base = { password };
    if (pk.twoFactor && pk.totpBound) base.totp = code;
    setSu(function(s) {
      return { ...s, busy: true, error: "" };
    });
    rpc("passkeyStepUp", base).then(function(j) {
      if (j.need !== "passkey") return finishStepUp(j.ticket || "");
      if (typeof window.PublicKeyCredential === "undefined") throw new Error("当前浏览器不支持通行密钥");
      return SWA.startAuthentication({ optionsJSON: j.options }).then(function(cred) {
        var again = { password, handle: j.handle, response: cred };
        if (pk.twoFactor && pk.totpBound) again.totp = code;
        return rpc("passkeyStepUp", again).then(function(j2) {
          return finishStepUp(j2.ticket || "");
        });
      });
    }).catch(stepUpError);
  }
  function removePasskey(p) {
    if (!window.confirm("删除通行密钥「" + p.label + "」？删除后该设备将无法再用它登录。")) return;
    askStepUp("remove", p.id, "", "");
  }
  function renamePasskey(p) {
    var next = window.prompt("为这个通行密钥设置新名称：", p.label);
    if (next === null) return;
    askStepUp("rename", p.id, "", next.slice(0, 40));
  }
  function passkeyLabel(p) {
    var kind = p.deviceType === "multiDevice" ? "可同步" : "仅此设备";
    var used = typeof p.lastUsedAt === "number" && p.lastUsedAt > 0 ? new Date(p.lastUsedAt).toLocaleString() : "未使用";
    return kind + " · 最近使用：" + used;
  }
  function renderStepUp() {
    if (!su.open) return null;
    var needTotp = pk.twoFactor && pk.totpBound;
    var title = su.action === "add" ? "添加通行密钥" : su.action === "rename" ? "重命名通行密钥" : "删除通行密钥";
    return React.createElement(
      "div",
      {
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2147483e3 }
      },
      React.createElement(
        "div",
        { className: "card", style: { width: 420, maxWidth: "calc(100vw - 40px)", margin: 0 } },
        React.createElement("h2", null, "确认身份 · " + title),
        React.createElement(
          "div",
          { className: "muted", style: { marginBottom: 4 } },
          "通行密钥可以代替密码登录，因此改动前必须确认是你本人。"
        ),
        React.createElement("label", null, t("password.current")),
        React.createElement("input", { type: "password", value: suPw, onChange: function(e) {
          setSuPw(e.target.value);
        }, autoComplete: "current-password" }),
        needTotp ? React.createElement(
          "div",
          null,
          React.createElement("label", null, "动态码（6 位）"),
          React.createElement("input", { value: suCode, onChange: function(e) {
            setSuCode(e.target.value);
          }, maxLength: 6, placeholder: "6 位动态码" })
        ) : null,
        pk.twoFactor && !pk.totpBound ? React.createElement(
          "div",
          { className: "muted", style: { marginTop: 8 } },
          "该账号的第二步验证是通行密钥：提交密码后会再要求你完成一次通行密钥验证。"
        ) : null,
        su.error !== "" ? React.createElement("div", { className: "err" }, su.error) : null,
        React.createElement(
          "div",
          { className: "row", style: { marginTop: 14 } },
          React.createElement("button", { onClick: submitStepUp, disabled: su.busy }, su.busy ? "验证中…" : "确认"),
          React.createElement("button", { className: "ghost", onClick: function() {
            setSu(suClosed());
            setSuPw("");
            setSuCode("");
          }, disabled: su.busy }, "取消")
        )
      )
    );
  }
  function run(task, okMsg) {
    setBusy(true);
    setErr("");
    setMsg("");
    Promise.resolve().then(task).then(function() {
      if (okMsg) setMsg(okMsg);
    }).catch(function(e) {
      if (e.code !== "session-expired") setErr(e.message);
    }).finally(function() {
      setBusy(false);
    });
  }
  function saveProfile() {
    run(function() {
      return rpc("updateProfile", { displayName: pDisplay, email: pEmail }).then(function(j) {
        setMe(j.me);
      });
    }, "个人信息已保存");
  }
  function checkCurrentPassword() {
    if (oldPw === "") {
      setOldCheck("idle");
      return;
    }
    rpc("verifyPassword", { password: oldPw }).then(function() {
      setOldCheck("ok");
    }).catch(function() {
      setOldCheck("bad");
    });
  }
  function changePassword() {
    if (newPw.length < 8) {
      setErr("新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）");
      return;
    }
    if (newPw !== newPw2) {
      setErr("两次输入的新密码不一致");
      return;
    }
    run(function() {
      return rpc("changePassword", { oldPassword: oldPw, newPassword: newPw }).then(function() {
        setOldPw("");
        setNewPw("");
        setNewPw2("");
      });
    }, "密码已修改（其他设备上的登录已失效）");
  }
  function createUser() {
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(cName)) {
      setErr("用户名仅允许 2-32 位字母、数字、下划线、点或短横线");
      return;
    }
    if (cPw.length < 8) {
      setErr("初始密码至少 8 位且含两种及以上字符类型");
      return;
    }
    run(function() {
      return rpc("createUser", { username: cName, password: cPw, role: cRole, displayName: cDisplay, email: cEmail }).then(function() {
        setCName("");
        setCPw("");
        setCRole("user");
        setCDisplay("");
        setCEmail("");
        refreshUsers();
      });
    }, "用户已创建");
  }
  function deleteUser(u) {
    if (!window.confirm("确定删除用户「" + u.username + "」？该操作不可撤销。")) return;
    run(function() {
      return rpc("deleteUser", { username: u.username }).then(refreshUsers);
    }, "用户已删除");
  }
  function resetPassword(u) {
    var pw = window.prompt("为用户「" + u.username + "」设置新密码（至少 8 位，含两种字符类型）：");
    if (pw === null) return;
    if (pw.length < 8) {
      setErr("新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）");
      return;
    }
    run(function() {
      return rpc("resetPassword", { username: u.username, newPassword: pw }).then(refreshUsers);
    }, "密码已重置");
  }
  function resetPasskeys(u) {
    if (!window.confirm("清除用户「" + u.username + "」的全部通行密钥？该用户将无法再用通行密钥登录（用于设备丢失时的账号救援）。")) return;
    run(function() {
      return rpc("passkeyReset", { username: u.username }).then(refreshUsers);
    }, "该用户的通行密钥已清除");
  }
  function toggleRole(u) {
    var next = u.role === "admin" ? "user" : "admin";
    if (!window.confirm("将「" + u.username + "」的角色改为「" + roleLabel(next) + "」？")) return;
    run(function() {
      return rpc("setRole", { username: u.username, role: next }).then(refreshUsers);
    }, "角色已更新");
  }
  function logout() {
    try {
      sessionStorage.removeItem("dshua-totp-reminded");
    } catch (e) {
    }
    fetch("/auth/logout", { method: "POST" }).then(function() {
      location.href = "/auth/login";
    }).catch(function() {
      location.href = "/auth/login";
    });
  }
  if (me === null && err === "") {
    return React.createElement("div", { className: "dshua" }, React.createElement("div", null, "加载中…"));
  }
  if (me === null) {
    return React.createElement("div", { className: "dshua" }, React.createElement("div", { className: "err" }, err));
  }
  var cards = [];
  cards.push(React.createElement(
    "div",
    { className: "card", key: "profile" },
    React.createElement("h2", null, "我的账号"),
    React.createElement("div", { className: "meta" }, "当前登录：" + me.username + "（" + roleLabel(me.role) + "）"),
    React.createElement("label", null, "昵称（显示名）"),
    React.createElement("input", { value: pDisplay, onChange: function(e) {
      setPDisplay(e.target.value);
    }, maxLength: 60 }),
    React.createElement("label", null, "邮箱"),
    React.createElement("input", { value: pEmail, onChange: function(e) {
      setPEmail(e.target.value);
    }, maxLength: 120 }),
    React.createElement(
      "div",
      { className: "row", style: { marginTop: 12 } },
      React.createElement("button", { onClick: saveProfile, disabled: busy }, "保存个人信息"),
      React.createElement("button", { className: "ghost", onClick: logout }, "退出登录")
    )
  ));
  var newLevel = passwordLevel(newPw);
  var unlocked = oldCheck === "ok";
  cards.push(React.createElement(
    "div",
    { className: "card", key: "password" },
    React.createElement("h2", null, t("password.submit")),
    React.createElement("label", null, t("password.current")),
    React.createElement("input", {
      type: "password",
      value: oldPw,
      autoComplete: "current-password",
      className: oldCheck === "ok" ? "pw-ok" : oldCheck === "bad" ? "pw-bad" : "",
      onChange: function(e) {
        setOldPw(e.target.value);
        setOldCheck("idle");
      },
      onBlur: checkCurrentPassword
    }),
    React.createElement(
      "div",
      { className: "pw-hint" },
      oldCheck === "ok" ? "当前密码正确，已解锁下面的输入框" : oldCheck === "bad" ? "当前密码不正确，下面的输入框保持锁定" : "离开此输入框时会自动校验；校验通过前下面两个输入框锁定"
    ),
    React.createElement("label", null, "新密码（至少 8 位，含两种字符类型）"),
    React.createElement("input", {
      type: "password",
      value: newPw,
      autoComplete: "new-password",
      disabled: !unlocked,
      className: !unlocked ? "locked" : newPw === "" ? "" : "pw-" + newLevel,
      onChange: function(e) {
        setNewPw(e.target.value);
      }
    }),
    unlocked && newPw !== "" ? React.createElement("div", { className: "pw-hint" }, "密码强度：" + levelText(newLevel)) : null,
    React.createElement("label", null, t("password.confirm")),
    React.createElement("input", {
      type: "password",
      value: newPw2,
      autoComplete: "new-password",
      disabled: !unlocked || newLevel === "bad",
      className: !unlocked || newLevel === "bad" ? "locked" : newPw2 === "" ? "pw-warn" : newPw2 === newPw ? "pw-ok" : "pw-bad",
      onChange: function(e) {
        setNewPw2(e.target.value);
      }
    }),
    newPw2 !== "" && unlocked && newLevel !== "bad" ? React.createElement("div", { className: "pw-hint" }, newPw2 === newPw ? t("password.match") : t("password.mismatch")) : null,
    React.createElement(
      "div",
      { className: "row", style: { marginTop: 12 } },
      React.createElement("button", {
        onClick: changePassword,
        disabled: busy || !unlocked || newLevel === "bad" || newPw2 !== newPw
      }, t("password.submit"))
    )
  ));
  var totpSetup = tSecret === "" ? React.createElement(
    "div",
    null,
    React.createElement(
      "div",
      { className: "muted", style: { marginBottom: 8 } },
      "使用 Google Authenticator / Microsoft Authenticator 等应用，通过 otpauth 链接或手动输入密钥添加本账号；启用后每次登录输入 6 位动态码。"
    ),
    React.createElement("button", { onClick: genTotp, disabled: busy }, "生成 TOTP 密钥")
  ) : React.createElement(
    "div",
    null,
    React.createElement("label", null, "用验证器扫描二维码添加（Google Authenticator / Microsoft Authenticator 等）"),
    tQrUrl !== "" ? React.createElement("img", { src: tQrUrl, alt: "TOTP 二维码", style: { display: "block", width: 200, height: 200, borderRadius: 8, background: "#fff", padding: 6, marginBottom: 6 } }) : null,
    React.createElement("label", null, "密钥（无法扫码时手动输入）"),
    React.createElement("code", { style: { display: "block", padding: "10px", borderRadius: 7, background: "var(--dsw-alias-bg-layer-1)", wordBreak: "break-all" } }, tSecret),
    React.createElement("label", null, "otpauth 链接"),
    React.createElement("code", { style: { display: "block", padding: "10px", borderRadius: 7, background: "var(--dsw-alias-bg-layer-1)", wordBreak: "break-all", fontSize: 12 } }, tOtpAuth),
    React.createElement("label", null, "输入验证器中的 6 位动态码以启用"),
    React.createElement("input", { value: tCode, onChange: function(e) {
      setTCode(e.target.value);
    }, placeholder: "6 位动态码", maxLength: 6 }),
    React.createElement(
      "div",
      { className: "row", style: { marginTop: 12 } },
      React.createElement("button", { onClick: enableTotp, disabled: busy }, "启用 TOTP"),
      React.createElement("button", { className: "ghost", onClick: function() {
        setTSecret("");
        setTOtpAuth("");
        setTQrUrl("");
        setTCode("");
      }, disabled: busy }, "取消")
    )
  );
  var hasFactor = totp.enabled || pk.list.length > 0;
  var factorText = totp.twoFactor ? totp.enabled ? "已启用两步验证（登录需密码 + 动态码）" : "已启用两步验证（登录需密码 + 通行密钥）" : "未启用两步验证（登录仅需密码）";
  cards.push(React.createElement(
    "div",
    { className: "card", key: "totp" },
    React.createElement("h2", null, totp.enabled ? "两步验证（TOTP）" : "两步验证"),
    React.createElement(
      "div",
      null,
      totp.enabled ? React.createElement("span", { className: "badge admin" }, "已绑定 TOTP") : React.createElement("span", { className: "badge user" }, "未绑定 TOTP"),
      pk.list.length > 0 ? React.createElement("span", { className: "badge admin" }, "通行密钥 " + pk.list.length + " 个") : null,
      totp.ignore ? React.createElement("span", { className: "meta" }, "（已永久忽略登录提醒）") : null
    ),
    hasFactor ? React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0" } },
        React.createElement(
          "label",
          { className: "switch" },
          React.createElement("input", { type: "checkbox", checked: totp.twoFactor === true, onChange: toggle2fa, disabled: busy }),
          React.createElement("span", { className: "track" }, React.createElement("span", { className: "thumb" }))
        ),
        React.createElement("label", { style: { cursor: "pointer", margin: 0, color: "var(--dsw-alias-label-secondary)" } }, factorText)
      ),
      React.createElement(
        "div",
        { className: "muted", style: { marginBottom: 6 } },
        totp.twoFactor ? "关闭后仅凭密码即可登录（通行密钥仍可直接登录）；开启状态下改动通行密钥需要先通过二次验证。" : "开启后登录需要第二个因子：已绑定 TOTP 时用动态码，否则用通行密钥。"
      ),
      totp.enabled ? React.createElement(
        "div",
        null,
        React.createElement("label", null, "移除令牌需输入当前 6 位动态码"),
        React.createElement("input", { value: tRmCode, onChange: function(e) {
          setTRmCode(e.target.value);
        }, placeholder: "6 位动态码", maxLength: 6 }),
        React.createElement(
          "div",
          { className: "row", style: { marginTop: 12 } },
          React.createElement("button", { className: "danger", onClick: removeTotp, disabled: busy }, "移除 TOTP"),
          React.createElement("button", { className: "ghost", onClick: toggleIgnore, disabled: busy }, totp.ignore ? "取消永久忽略" : "永久忽略登录提醒")
        )
      ) : React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "muted", style: { marginBottom: 8 } },
          "当前账号没有 TOTP 令牌，两步验证由通行密钥完成。如需改用动态码，可在下方生成并绑定 TOTP。"
        ),
        totpSetup
      )
    ) : totpSetup
  ));
  var pkSupported = pk.rp !== null && pk.rp.supported === true;
  var pkPort = "";
  try {
    pkPort = location.port !== "" ? ":" + location.port : "";
  } catch (e) {
  }
  cards.push(React.createElement(
    "div",
    { className: "card", key: "passkey" },
    React.createElement("h2", null, "通行密钥（Passkey）"),
    React.createElement(
      "div",
      null,
      pk.list.length > 0 ? React.createElement("span", { className: "badge admin" }, "已绑定 " + pk.list.length + " 个") : React.createElement("span", { className: "badge user" }, "未绑定"),
      pk.twoFactor ? React.createElement("span", { className: "meta" }, "两步验证已开启") : null,
      pk.list.length >= pk.max ? React.createElement("span", { className: "meta" }, "已达上限 " + pk.max + " 个") : null
    ),
    !pk.loaded ? React.createElement("div", { className: "muted", style: { marginTop: 8 } }, "加载中…") : null,
    pk.loaded && !pkSupported ? React.createElement(
      "div",
      { className: "err", style: { marginTop: 8 } },
      (pk.rp !== null && pk.rp.error ? pk.rp.error : "当前访问地址无法使用通行密钥。") + (pk.rp !== null && pk.rp.suggestedHost ? "请改用 http://" + pk.rp.suggestedHost + pkPort + " 打开面板后再试。" : "")
    ) : null,
    pk.loaded && pkSupported ? React.createElement(
      "div",
      { className: "muted", style: { marginTop: 8 } },
      "用指纹 / 面容 / 设备 PIN 代替密码登录。私钥永不离开设备，服务器只保存公钥；一个账号可以绑定多个（本机设备、多台手机）。"
    ) : null,
    pk.loaded && pkSupported && pk.list.length > 0 ? React.createElement(
      "table",
      null,
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement("th", null, t("models.colName")),
          React.createElement("th", null, "类型"),
          React.createElement("th", null, "操作")
        )
      ),
      React.createElement(
        "tbody",
        null,
        pk.list.map(function(p) {
          return React.createElement(
            "tr",
            { key: p.id },
            React.createElement(
              "td",
              null,
              p.label,
              p.backedUp ? React.createElement("span", { className: "meta" }, "已备份") : null
            ),
            React.createElement("td", null, React.createElement("span", { className: "muted" }, passkeyLabel(p))),
            React.createElement(
              "td",
              null,
              React.createElement(
                "div",
                { className: "actions" },
                React.createElement("button", { className: "ghost", onClick: function() {
                  renamePasskey(p);
                }, disabled: busy || su.busy }, "重命名"),
                React.createElement("button", { className: "danger", onClick: function() {
                  removePasskey(p);
                }, disabled: busy || su.busy }, t("common.remove"))
              )
            )
          );
        })
      )
    ) : null,
    pk.loaded && pkSupported && pk.list.length < pk.max ? React.createElement(
      "div",
      null,
      React.createElement("label", null, "名称（可选，便于区分设备）"),
      React.createElement("input", { value: pkName, onChange: function(e) {
        setPkName(e.target.value);
      }, maxLength: 40, placeholder: "例如：我的笔记本 / iPhone" }),
      React.createElement(
        "div",
        { className: "row", style: { marginTop: 12 } },
        React.createElement("button", { onClick: function() {
          askStepUp("add", "", "localDevice", pkName);
        }, disabled: busy || su.busy }, "＋ 本机通行密钥"),
        React.createElement("button", { className: "ghost", onClick: function() {
          askStepUp("add", "", "remoteDevice", pkName);
        }, disabled: busy || su.busy }, "📱 手机扫码添加")
      ),
      React.createElement(
        "div",
        { className: "muted", style: { marginTop: 8 } },
        "「本机通行密钥」使用这台电脑的指纹 / 面容 / Windows Hello；「手机扫码添加」由浏览器显示二维码，用手机相机扫码后在本机完成绑定（手机无需与电脑处于同一网络）。"
      )
    ) : null
  ));
  if (isAdmin) {
    cards.push(React.createElement(
      "div",
      { className: "card", key: "admin" },
      React.createElement("h2", null, "用户管理（管理员）"),
      React.createElement("label", null, "新增用户：用户名"),
      React.createElement("input", { value: cName, onChange: function(e) {
        setCName(e.target.value);
      }, placeholder: "2-32 位字母、数字、_ . -", maxLength: 32 }),
      React.createElement("label", null, "初始密码（至少 8 位，含两种字符类型）"),
      React.createElement("input", { type: "password", value: cPw, onChange: function(e) {
        setCPw(e.target.value);
      }, placeholder: "密码仅本次设置，之后无法查看" }),
      React.createElement(
        "div",
        { className: "row" },
        React.createElement(
          "div",
          { className: "grow" },
          React.createElement("label", null, "角色"),
          React.createElement(
            "select",
            { value: cRole, onChange: function(e) {
              setCRole(e.target.value);
            } },
            React.createElement("option", { value: "user" }, "普通用户"),
            React.createElement("option", { value: "admin" }, "管理员")
          )
        ),
        React.createElement(
          "div",
          { className: "grow" },
          React.createElement("label", null, "昵称"),
          React.createElement("input", { value: cDisplay, onChange: function(e) {
            setCDisplay(e.target.value);
          }, maxLength: 60 })
        ),
        React.createElement(
          "div",
          { className: "grow" },
          React.createElement("label", null, "邮箱"),
          React.createElement("input", { value: cEmail, onChange: function(e) {
            setCEmail(e.target.value);
          }, maxLength: 120 })
        )
      ),
      React.createElement(
        "div",
        { className: "row", style: { marginTop: 12 } },
        React.createElement("button", { onClick: createUser, disabled: busy }, "创建用户")
      ),
      React.createElement(
        "table",
        null,
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("th", null, "用户名"),
            React.createElement("th", null, "角色"),
            React.createElement("th", null, "昵称"),
            React.createElement("th", null, "邮箱"),
            React.createElement("th", null, "通行密钥"),
            React.createElement("th", null, "操作")
          )
        ),
        React.createElement(
          "tbody",
          null,
          users.map(function(u) {
            return React.createElement(
              "tr",
              { key: u.username },
              React.createElement("td", null, u.username, me.username === u.username ? React.createElement("span", { className: "meta" }, "（我）") : null),
              React.createElement("td", null, React.createElement("span", { className: "badge " + u.role }, roleLabel(u.role))),
              React.createElement("td", null, u.displayName || "—"),
              React.createElement("td", null, u.email || "—"),
              React.createElement("td", null, (u.passkeyCount || 0) + " 个"),
              React.createElement(
                "td",
                null,
                React.createElement(
                  "div",
                  { className: "actions" },
                  React.createElement("button", { className: "ghost", onClick: function() {
                    resetPassword(u);
                  }, disabled: busy }, "重置密码"),
                  (u.passkeyCount || 0) > 0 ? React.createElement("button", { className: "ghost", onClick: function() {
                    resetPasskeys(u);
                  }, disabled: busy }, "清除通行密钥") : null,
                  React.createElement("button", { className: "ghost", onClick: function() {
                    toggleRole(u);
                  }, disabled: busy }, "切换角色"),
                  React.createElement("button", { className: "danger", onClick: function() {
                    deleteUser(u);
                  }, disabled: busy }, t("common.remove"))
                )
              )
            );
          })
        )
      ),
      React.createElement(
        "div",
        { className: "muted", style: { marginTop: 8 } },
        "说明：管理员可以新增、删除用户并重置密码，也可以在设备丢失时清除某个用户的通行密钥（用于账号救援），但无法查看任何人的当前密码。不能删除或降级最后一个管理员。"
      )
    ));
  }
  if (isAdmin) {
    cards.push(React.createElement(
      "div",
      { className: "card", key: "invites" },
      React.createElement("h2", null, "邀请码管理（管理员）"),
      React.createElement(
        "div",
        { className: "muted", style: { marginBottom: 6 } },
        "新用户注册必须输入有效邀请码；每个码可按设置的可注册次数使用。"
      ),
      React.createElement(
        "div",
        { className: "row" },
        React.createElement(
          "div",
          { className: "grow" },
          React.createElement("label", null, "生成数量（1-50）"),
          React.createElement("input", { value: iAmount, onChange: function(e) {
            setIAmount(e.target.value);
          }, placeholder: "1" })
        ),
        React.createElement(
          "div",
          { className: "grow" },
          React.createElement("label", null, "每个码可注册次数（1-100）"),
          React.createElement("input", { value: iUses, onChange: function(e) {
            setIUses(e.target.value);
          }, placeholder: "1" })
        ),
        React.createElement(
          "div",
          { className: "grow", style: { alignSelf: "flex-end" } },
          React.createElement("button", { onClick: createInvites, disabled: busy }, "生成邀请码")
        )
      ),
      React.createElement(
        "table",
        null,
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("th", null, "邀请码"),
            React.createElement("th", null, "已用 / 可注册"),
            React.createElement("th", null, "剩余"),
            React.createElement("th", null, "创建者"),
            React.createElement("th", null, "操作")
          )
        ),
        React.createElement(
          "tbody",
          null,
          invites.length === 0 ? React.createElement("tr", null, React.createElement("td", { colSpan: 5, className: "muted" }, "暂无邀请码")) : invites.map(function(v) {
            return React.createElement(
              "tr",
              { key: v.code },
              React.createElement("td", null, React.createElement("code", null, v.code)),
              React.createElement("td", null, v.used + " / " + v.total),
              React.createElement("td", null, React.createElement("span", { className: "badge " + (v.remaining > 0 ? "user" : "admin") }, v.remaining)),
              React.createElement("td", null, v.createdBy),
              React.createElement(
                "td",
                null,
                React.createElement(
                  "div",
                  { className: "actions" },
                  React.createElement("button", { className: "danger", onClick: function() {
                    revokeInvite(v.code);
                  }, disabled: busy }, "撤销")
                )
              )
            );
          })
        )
      )
    ));
  }
  cards.push(React.createElement("div", { className: "msg", key: "msg" }, msg));
  cards.push(React.createElement("div", { className: "err", key: "err" }, err));
  return React.createElement("div", { className: "dshua" }, cards, renderStepUp());
}
function errText(e) {
  return String(e && (e.message || e.error || e.code) || e);
}
function UserModelsPage() {
  var st = React.useState({ loaded: false, unlocked: false, profiles: [], error: "", selected: "", busy: "" });
  var state = st[0], setState = st[1];
  var pw = React.useState("");
  var password = pw[0], setPassword = pw[1];
  var fm = React.useState({ label: "", model: "deepseek-chat", baseUrl: "", apiKey: "" });
  var form = fm[0], setForm = fm[1];
  var kt = React.useState({ busy: false, result: "" });
  var keyTest = kt[0], setKeyTest = kt[1];
  var bl = React.useState({});
  var balances = bl[0], setBalances = bl[1];
  function refresh(pick) {
    rpc("profileList", {}).then(function(j) {
      var list = j.profiles || [];
      setState(function(prev) {
        var selected = pick !== void 0 ? pick : prev.selected;
        if (selected === "" && list.length > 0) selected = list[0].profileId;
        return { loaded: true, unlocked: j.unlocked === true, profiles: list, error: "", selected, busy: "" };
      });
    }).catch(function(e) {
      setState(function(prev) {
        return { ...prev, loaded: true, error: errText(e), busy: "" };
      });
    });
  }
  React.useEffect(function() {
    refresh();
  }, []);
  function act(method, body, pick) {
    setState(function(prev) {
      return { ...prev, busy: method };
    });
    rpc(method, body).then(function() {
      refresh(pick);
    }).catch(function(e) {
      setState(function(prev) {
        return { ...prev, error: errText(e), busy: "" };
      });
    });
  }
  function queryAllBalances() {
    setState(function(prev) {
      return { ...prev, busy: "balance", error: "" };
    });
    rpc("balanceQueryAll", {}).then(function(j) {
      var results = j.results || {};
      var next = {};
      Object.keys(results).forEach(function(id) {
        var row = results[id] || {};
        next[id] = row.error !== void 0 ? row.error === "locked" ? t("common.needUnlock") : row.error === "rate-limited" ? t("common.later") : row.error === "no-profile" ? "未选择配置" : t("common.notAvailable") : (row.currency || "CNY") + " " + String(row.total);
      });
      setBalances(next);
      setState(function(prev) {
        return { ...prev, busy: "" };
      });
    }).catch(function(e) {
      setState(function(prev) {
        return { ...prev, busy: "", error: errText(e) };
      });
    });
  }
  function checkKeyValidity() {
    setKeyTest({ busy: true, result: "" });
    rpc("profileTestKey", { apiKey: form.apiKey, baseUrl: form.baseUrl }).then(function(j) {
      var b = j.balance || {};
      setKeyTest({ busy: false, result: "✔ 连通可用，余额 " + (b.currency || "CNY") + " " + String(b.total) });
    }).catch(function(e) {
      setKeyTest({ busy: false, result: "✘ " + errText(e) });
    });
  }
  function selectedProfile() {
    return state.profiles.filter(function(p) {
      return String(p.profileId) === state.selected;
    })[0];
  }
  var children = [];
  children.push(React.createElement("h2", null, t("models.title")));
  children.push(React.createElement(
    "div",
    { className: "muted", style: { marginBottom: 10 } },
    "这里的配置只属于你自己：其他用户（包括管理员）都无法查看你的 API Key。管理员分享给你的配置可以直接选用，能看到余额，但看不到 Key。"
  ));
  if (state.error !== "") {
    children.push(React.createElement("div", { style: { color: "var(--dsw-alias-label-error, #ff6b6b)", marginBottom: 8 } }, state.error));
  }
  var toolbar = [];
  if (state.loaded && !state.unlocked) {
    children.push(React.createElement(
      "div",
      { key: "pw-row", className: "fields" },
      React.createElement(
        "div",
        { className: "field compact" },
        React.createElement("label", null, t("models.passwordLabel")),
        React.createElement("input", {
          type: "password",
          placeholder: t("models.passwordPlaceholder"),
          value: password,
          "aria-label": t("models.passwordLabel"),
          onChange: function(e) {
            setPassword(e.target.value);
          }
        })
      )
    ));
    toolbar.push(React.createElement("button", {
      key: "unlock",
      disabled: password === "",
      onClick: function() {
        act("profileUnlock", { password });
        setPassword("");
      }
    }, t("common.unlock")));
  }
  toolbar.push(React.createElement("button", {
    key: "balance",
    disabled: state.profiles.length === 0 || state.busy === "balance",
    onClick: queryAllBalances
  }, state.busy === "balance" ? t("common.querying") : t("models.balanceAll")));
  toolbar.push(React.createElement("button", {
    key: "default",
    disabled: selectedProfile() === void 0 || selectedProfile().source === "shared",
    onClick: function() {
      act("profileSetDefault", { profileId: state.selected });
    }
  }, t("models.setDefault")));
  toolbar.push(React.createElement("button", {
    key: "use",
    disabled: selectedProfile() === void 0 || selectedProfile().source !== "shared",
    onClick: function() {
      var parts = String(state.selected).split("/");
      act("shareSelect", { ownerUid: parts[0], profileId: parts[1] });
    }
  }, t("models.useShare")));
  toolbar.push(React.createElement("button", {
    key: "remove",
    disabled: selectedProfile() === void 0 || selectedProfile().source === "shared",
    onClick: function() {
      act("profileRemove", { profileId: state.selected });
    }
  }, t("common.remove")));
  children.push(React.createElement("div", { key: "toolbar", className: "toolbar" }, toolbar));
  var rows = state.profiles.map(function(p) {
    var id = String(p.profileId);
    var isShared = p.source === "shared";
    return React.createElement(
      "tr",
      {
        key: id,
        onClick: function() {
          setState(function(prev) {
            return { ...prev, selected: id };
          });
        },
        style: { cursor: "pointer", background: state.selected === id ? "var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12))" : void 0 }
      },
      React.createElement("td", null, state.selected === id ? "●" : "○"),
      React.createElement("td", null, p.label || "未命名"),
      React.createElement("td", null, String(p.model || "—")),
      React.createElement("td", null, isShared ? t("models.sharedByAdmin") : p.hint || "—"),
      React.createElement("td", null, p.isDefault ? "是" : ""),
      React.createElement("td", null, balances[id] !== void 0 ? balances[id] : "—")
    );
  });
  children.push(React.createElement(
    "table",
    { key: "table" },
    React.createElement("thead", null, React.createElement(
      "tr",
      null,
      React.createElement("th", null, ""),
      React.createElement("th", null, t("models.colName")),
      React.createElement("th", null, t("models.colModel")),
      React.createElement("th", null, "API Key"),
      React.createElement("th", null, t("models.colDefault")),
      React.createElement("th", null, t("models.colBalance"))
    )),
    React.createElement("tbody", null, rows.length === 0 ? React.createElement("tr", null, React.createElement("td", { colSpan: 6, className: "muted" }, "还没有配置。未配置时模型调用会被拒绝——不会回退到部署级配置。")) : rows)
  ));
  children.push(React.createElement("div", { key: "add-title", style: { fontWeight: 600, margin: "14px 0 6px" } }, t("models.addTitle")));
  children.push(React.createElement(
    "div",
    { key: "add", className: "fields" },
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, t("models.colName")),
      React.createElement("input", { placeholder: "例如：我的 DeepSeek", value: form.label, onChange: function(e) {
        setForm({ ...form, label: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, t("models.fieldModel")),
      React.createElement("input", { placeholder: "deepseek-chat", value: form.model, onChange: function(e) {
        setForm({ ...form, model: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, "baseURL（留空用官方地址）"),
      React.createElement("input", { placeholder: "https://api.deepseek.com", value: form.baseUrl, onChange: function(e) {
        setForm({ ...form, baseUrl: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, "API Key"),
      React.createElement("input", { type: "password", placeholder: "sk-…", value: form.apiKey, onChange: function(e) {
        setForm({ ...form, apiKey: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "actions", style: { margin: "0 0 10px" } },
      React.createElement("button", {
        disabled: form.apiKey === "" || keyTest.busy,
        onClick: checkKeyValidity
      }, keyTest.busy ? t("common.checking") : t("common.checkKey")),
      React.createElement("button", {
        disabled: form.model === "" || form.apiKey === "",
        onClick: function() {
          act("profileCreate", { label: form.label, provider: "deepseek", model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey });
          setForm({ label: "", model: "deepseek-chat", baseUrl: "", apiKey: "" });
        }
      }, t("common.add"))
    )
  ));
  if (keyTest.result !== "") {
    children.push(React.createElement("div", { key: "keytest", className: "pw-hint" }, keyTest.result));
  }
  return React.createElement("div", { className: "dshua" }, React.createElement("div", { className: "card" }, children));
}
function dedupeSettingsNav(key) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  var labels = [message("zh", key), message("en", key)];
  var converge = function() {
    var navs = document.querySelectorAll("[role=dialog] nav");
    for (var i = 0; i < navs.length; i++) {
      var buttons = navs[i].querySelectorAll("button, [role=button]");
      var kept = 0;
      for (var j = 0; j < buttons.length; j++) {
        var element = buttons[j];
        if (labels.indexOf((element.textContent || "").trim()) === -1) continue;
        kept += 1;
        if (kept > 1) {
          element.style.display = "none";
          element.setAttribute("data-dshua-dedup", "1");
        }
      }
    }
  };
  converge();
  new MutationObserver(converge).observe(document.body, { childList: true, subtree: true });
}
var PLUGIN_MANAGER_ACTIONS = [
  "安装",
  "卸载",
  "启用",
  "停用",
  "禁用",
  "更新",
  "升级",
  "重载",
  "Install",
  "Uninstall",
  "Enable",
  "Disable",
  "Update",
  "Reload"
];
function enforcePluginManagerReadOnly() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  var mark = function() {
    var nodes = document.querySelectorAll("button, [role=button]");
    for (var i = 0; i < nodes.length; i++) {
      var element = nodes[i];
      if (element.closest(".dshua") !== null) continue;
      if (element.dataset.dshuaReadonly === "1") continue;
      var label = (element.textContent || "").trim();
      if (PLUGIN_MANAGER_ACTIONS.indexOf(label) === -1) continue;
      element.dataset.dshuaReadonly = "1";
      element.setAttribute("disabled", "disabled");
      element.setAttribute("aria-disabled", "true");
      element.setAttribute("title", "仅部署者可以安装、卸载或启停插件（服务端会拒绝该操作）");
      element.style.opacity = "0.5";
      element.style.pointerEvents = "none";
    }
  };
  mark();
  new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
}
function SharesPage() {
  var st = React.useState({ loaded: false, shared: [], usage: [], grants: [], error: "", selected: "" });
  var state = st[0], setState = st[1];
  var fm = React.useState({ label: "", model: "deepseek-chat", baseUrl: "", apiKey: "" });
  var form = fm[0], setForm = fm[1];
  var tk = React.useState({ busy: false, result: "" });
  var keyTest = tk[0], setKeyTest = tk[1];
  var gr = React.useState({ username: "" });
  var grant = gr[0], setGrant = gr[1];
  function refresh(pick) {
    Promise.all([rpc("shareOwn", {}), rpc("shareUsage", {}), rpc("shareGrants", {})]).then(function(r) {
      var shared = r[0].shared || [];
      setState(function(prev) {
        var selected = pick !== void 0 ? pick : prev.selected;
        if (selected === "" && shared.length > 0) selected = shared[0].profileId;
        return { loaded: true, shared, usage: r[1].usage || [], grants: r[2].grants || [], error: "", selected };
      });
    }).catch(function(e) {
      setState(function(prev) {
        return { ...prev, loaded: true, error: errText(e) };
      });
    });
  }
  React.useEffect(function() {
    refresh();
  }, []);
  function act(method, body, pick) {
    rpc(method, body).then(function() {
      refresh(pick);
    }).catch(function(e) {
      setState(function(prev) {
        return { ...prev, error: errText(e) };
      });
    });
  }
  function checkKey() {
    setKeyTest({ busy: true, result: "" });
    rpc("profileTestKey", { apiKey: form.apiKey, baseUrl: form.baseUrl }).then(function(j) {
      var b = j.balance || {};
      setKeyTest({ busy: false, result: "✔ Key 可用，余额 " + (b.currency || "CNY") + " " + String(b.total) });
    }).catch(function(e) {
      setKeyTest({ busy: false, result: "✘ " + errText(e) });
    });
  }
  function granteesOf(profileId) {
    var rows = [];
    state.grants.forEach(function(entry) {
      if ((entry.profileIds || []).indexOf(profileId) !== -1) rows.push(entry);
    });
    return rows;
  }
  function usageOf(profileId) {
    var rows = state.usage.filter(function(u) {
      return u.profileId === profileId;
    });
    if (rows.length === 0) return "暂无用量";
    return rows.map(function(u) {
      return String(u.targetUid).slice(0, 8) + ": " + u.calls + " 次 / " + u.tokens + " tokens";
    }).join("；");
  }
  var children = [];
  children.push(React.createElement("h2", null, t("shares.title")));
  children.push(React.createElement(
    "div",
    { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 13, lineHeight: "20px", marginBottom: 12 } },
    "把你的模型分享给指定用户：对方可以选用并查看余额，但看不到你的 API Key；撤销后立即失效。"
  ));
  if (state.error !== "") {
    children.push(React.createElement("div", { style: { color: "var(--dsw-alias-label-error, #ff6b6b)", marginBottom: 10 } }, state.error));
  }
  children.push(React.createElement(
    "div",
    { key: "new", className: "fields" },
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, "分享名称"),
      React.createElement("input", { placeholder: "例如：共享 DeepSeek", value: form.label, onChange: function(e) {
        setForm({ ...form, label: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, t("shares.fieldModel")),
      React.createElement("input", { placeholder: "deepseek-chat", value: form.model, onChange: function(e) {
        setForm({ ...form, model: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, "baseURL（留空用官方地址）"),
      React.createElement("input", { placeholder: "https://api.deepseek.com", value: form.baseUrl, onChange: function(e) {
        setForm({ ...form, baseUrl: e.target.value });
      } })
    ),
    React.createElement(
      "div",
      { className: "field" },
      React.createElement("label", null, "API Key"),
      React.createElement("input", { type: "password", placeholder: "sk-…", value: form.apiKey, onChange: function(e) {
        setForm({ ...form, apiKey: e.target.value });
      } })
    )
  ));
  children.push(React.createElement(
    "div",
    { key: "new-actions", className: "actions", style: { margin: "0 0 10px" } },
    React.createElement("button", { onClick: checkKey, disabled: form.apiKey === "" || keyTest.busy }, keyTest.busy ? "检查中…" : "检查 Key"),
    React.createElement("button", {
      disabled: form.model === "" || form.apiKey === "",
      onClick: function() {
        act("shareCreate", { label: form.label, provider: "deepseek", model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey });
        setForm({ label: "", model: "deepseek-chat", baseUrl: "", apiKey: "" });
        setKeyTest({ busy: false, result: "" });
      }
    }, t("shares.create"))
  ));
  if (keyTest.result !== "") {
    children.push(React.createElement("div", { key: "keytest", style: { fontSize: 12, marginBottom: 10, color: "var(--dsw-alias-label-secondary)" } }, keyTest.result));
  }
  if (state.shared.length > 0) {
    children.push(React.createElement(
      "div",
      { key: "picker", style: { display: "flex", gap: 8, alignItems: "center", margin: "6px 0 12px" } },
      React.createElement("span", { style: { whiteSpace: "nowrap" } }, "分享的 API Key："),
      React.createElement("select", {
        value: state.selected,
        "aria-label": "选择分享的 API Key",
        onChange: function(e) {
          setState(function(prev) {
            return { ...prev, selected: e.target.value };
          });
        }
      }, state.shared.map(function(p) {
        return React.createElement("option", { key: p.profileId, value: p.profileId }, (p.label || "分享") + " · " + p.model);
      }))
    ));
  }
  state.shared.forEach(function(p) {
    if (p.profileId !== state.selected) return;
    var rows = granteesOf(p.profileId);
    children.push(React.createElement(
      "div",
      { key: p.profileId, style: { borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: 10 } },
      React.createElement("div", { style: { fontWeight: 600 } }, (p.label || "分享") + " · " + p.model),
      React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, margin: "4px 0 8px" } }, "用量：" + usageOf(p.profileId)),
      React.createElement("div", { style: { fontWeight: 600, marginBottom: 4 } }, t("shares.grantees")),
      rows.length === 0 ? React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, t("shares.noGrantees")) : React.createElement("div", null, rows.map(function(entry) {
        return React.createElement(
          "div",
          { key: entry.targetUid, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0" } },
          React.createElement("span", null, entry.username),
          React.createElement("button", {
            onClick: function() {
              act("shareRevoke", { profileId: p.profileId, username: entry.username });
            }
          }, t("shares.revoke"))
        );
      })),
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 8 } },
        React.createElement("input", {
          placeholder: t("shares.grantPlaceholder"),
          value: grant.username,
          onChange: function(e) {
            setGrant({ username: e.target.value });
          }
        }),
        React.createElement("button", {
          disabled: grant.username === "",
          onClick: function() {
            act("shareGrant", { profileId: p.profileId, username: grant.username }, p.profileId);
            setGrant({ username: "" });
          }
        }, t("shares.grant"))
      )
    ));
  });
  if (state.loaded && state.shared.length === 0) {
    children.push(React.createElement("div", { key: "empty", style: { color: "var(--dsw-alias-label-secondary)" } }, t("shares.empty")));
  }
  return React.createElement("div", { className: "dshua" }, React.createElement("div", { className: "card" }, children));
}
function showTotpReminder() {
  if (typeof document === "undefined") return;
  if (document.getElementById("dshua-totp-reminder") !== null) return;
  try {
    if (sessionStorage.getItem("dshua-totp-reminded") === "1") return;
  } catch (e) {
  }
  var overlay = document.createElement("div");
  overlay.id = "dshua-totp-reminder";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000";
  var card = document.createElement("div");
  card.style.cssText = "width:420px;max-width:calc(100vw - 40px);background:var(--dsw-alias-bg-layer-2,#171a21);border:1px solid var(--dsw-alias-border-l2,#2a2f3a);border-radius:12px;padding:24px;color:var(--dsw-alias-label-primary,#e6e6e6);font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.45)";
  var title = document.createElement("div");
  title.textContent = "建议开启两步验证";
  title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:10px";
  var body = document.createElement("div");
  body.textContent = "为增强账号安全，建议在【设置】→【用户管理】中添加登录因子：TOTP 动态码令牌（Google Authenticator / Microsoft Authenticator 等）或通行密钥（指纹 / 面容 / 设备 PIN）。也可以永久忽略此提醒。";
  body.style.cssText = "color:var(--dsw-alias-label-secondary,#aab2c3);line-height:22px;margin-bottom:18px";
  var row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
  function close() {
    try {
      overlay.remove();
    } catch (e) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  }
  var later = document.createElement("button");
  later.textContent = "稍后再说";
  later.style.cssText = "padding:8px 14px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit";
  later.addEventListener("click", close);
  var ignore = document.createElement("button");
  ignore.textContent = "永久忽略";
  ignore.style.cssText = "padding:8px 14px;border-radius:7px;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit";
  ignore.addEventListener("click", function() {
    rpc("totpIgnore", { ignore: true }).catch(function() {
    });
    close();
  });
  row.appendChild(later);
  row.appendChild(ignore);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(row);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  try {
    sessionStorage.setItem("dshua-totp-reminded", "1");
  } catch (e) {
  }
}
exports.name = "dsh-ui-auth";
var localeTick = [];
function notifyLocaleChange() {
  localeTick.slice().forEach(function(listener) {
    listener();
  });
}
var t = function(key, params) {
  return message(normalizeLocale(typeof document !== "undefined" ? document.documentElement.lang : "zh"), key, params);
};
var activeLocale = "zh";
var localeRef;
var TRANSLATED_ATTRS = ["placeholder", "aria-label", "title"];
var textOriginals = /* @__PURE__ */ new WeakMap();
var attrOriginals = /* @__PURE__ */ new WeakMap();
function translateInside(root) {
  if (typeof document === "undefined" || typeof NodeFilter === "undefined") return;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var node = walker.nextNode();
  while (node !== null) {
    var original = textOriginals.get(node);
    if (original === void 0) {
      original = node.nodeValue ?? "";
      textOriginals.set(node, original);
    }
    var next = activeLocale === "en" ? translatePhrase("en", original) : original;
    if (node.nodeValue !== next) node.nodeValue = next;
    node = walker.nextNode();
  }
  var element = root;
  if (typeof element.querySelectorAll !== "function") return;
  var fields = element.querySelectorAll("[placeholder],[aria-label],[title]");
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    var store = attrOriginals.get(field) ?? {};
    for (var j = 0; j < TRANSLATED_ATTRS.length; j++) {
      var name = TRANSLATED_ATTRS[j];
      if (typeof field.getAttribute !== "function" || !field.hasAttribute(name)) continue;
      if (store[name] === void 0) store[name] = field.getAttribute(name) ?? "";
      var value = activeLocale === "en" ? translatePhrase("en", store[name]) : store[name];
      if (field.getAttribute(name) !== value) field.setAttribute(name, value);
    }
    attrOriginals.set(field, store);
  }
}
function translateOurDom() {
  if (typeof document === "undefined") return;
  try {
    activeLocale = detectLocale();
  } catch (error) {
  }
  var roots = document.querySelectorAll(".dshua, [role=dialog]");
  for (var i = 0; i < roots.length; i++) translateInside(roots[i]);
}
function installLocaleObserver() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  var attach = function() {
    if (document.body === null || document.body === void 0) {
      setTimeout(attach, 200);
      return;
    }
    new MutationObserver(function() {
      translateOurDom();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    translateOurDom();
  };
  attach();
}
function detectLocale() {
  try {
    if (t("models.title") === message("en", "models.title")) return "en";
    if (t("models.title") === message("zh", "models.title")) return "zh";
  } catch (error) {
  }
  try {
    var snapshot = localeRef?.getSnapshot?.();
    var active = snapshot === void 0 || snapshot === null ? "" : String(snapshot.active ?? "");
    if (active !== "") return normalizeLocale(active);
  } catch (error) {
  }
  try {
    var tag = typeof document !== "undefined" ? document.documentElement.lang : "";
    if (tag !== "") return normalizeLocale(tag);
  } catch (error) {
  }
  return "zh";
}
function refreshLocale() {
  try {
    activeLocale = detectLocale();
    translateOurDom();
  } catch (error) {
  }
}
exports.inject = ["slots"];
exports.apply = function apply(ctx) {
  const localeService = ctx.get("locale");
  localeRef = localeService;
  const register = localeService?.register;
  const bind = localeService?.bind;
  const effect = ctx.effect;
  if (register !== void 0 && bind !== void 0 && effect !== void 0) {
    effect(function() {
      return register("dsh-ui-auth", dictionaries());
    });
    t = bind("dsh-ui-auth");
  }
  refreshLocale();
  installLocaleObserver();
  if (typeof ctx.on === "function") {
    ctx.on("locale/change", function() {
      refreshLocale();
      notifyLocaleChange();
    });
  }
  injectAuthCss();
  mountSettings(ctx, 0);
};
function mountSettings(ctx, attempt) {
  var slots = ctx.get("slots");
  if (slots === void 0) {
    if (attempt < 40) {
      setTimeout(function() {
        mountSettings(ctx, attempt + 1);
      }, 250);
      return;
    }
    console.error("[dsh-ui-auth] slots 服务不可用：设置面板「用户管理」未能注册");
    return;
  }
  slots.inject("settings.section", function() {
    return slots.register(
      { name: "settings.section", id: "auth-users", order: 30, label: function() {
        return "用户管理";
      } },
      function() {
        return React.createElement(AuthUsersPage);
      }
    );
  });
  rpc("me", {}).then(function(j) {
    if (j.me !== void 0 && j.me.role !== "admin") {
      slots.inject("settings.section", function() {
        return slots.register(
          { name: "settings.section", id: "models", order: 10, priority: -1, label: function() {
            return t("models.title");
          } },
          function() {
            return React.createElement(UserModelsPage);
          }
        );
      });
      dedupeSettingsNav("models.title");
    }
    if (j.me !== void 0 && j.me.role === "admin") {
      slots.inject("settings.section", function() {
        return slots.register(
          { name: "settings.section", id: "auth-shares", order: 31, label: function() {
            return t("shares.title");
          } },
          function() {
            return React.createElement(SharesPage);
          }
        );
      });
    }
    if (j.me !== void 0 && j.me.role !== "admin") {
      enforcePluginManagerReadOnly();
    }
    if (j.me !== void 0 && j.me.totpEnabled !== true && (j.me.passkeyCount || 0) === 0 && j.me.totpIgnore !== true) {
      setTimeout(showTotpReminder, 600);
    }
  }).catch(function(e) {
  });
}
		return module.exports;
	}
});

