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
      constructor({ message, code, cause, name }) {
        super(message, { cause });
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
  ".dshua .switch input:disabled + .track{opacity:.55}"
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
  var oldPwS = _s(""), oldPw = oldPwS[0], setOldPw = oldPwS[1];
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
        React.createElement("label", null, "当前密码"),
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
  cards.push(React.createElement(
    "div",
    { className: "card", key: "password" },
    React.createElement("h2", null, "修改密码"),
    React.createElement("label", null, "当前密码"),
    React.createElement("input", { type: "password", value: oldPw, onChange: function(e) {
      setOldPw(e.target.value);
    }, autoComplete: "current-password" }),
    React.createElement("label", null, "新密码（至少 8 位，含两种字符类型）"),
    React.createElement("input", { type: "password", value: newPw, onChange: function(e) {
      setNewPw(e.target.value);
    }, autoComplete: "new-password" }),
    React.createElement("label", null, "确认新密码"),
    React.createElement("input", { type: "password", value: newPw2, onChange: function(e) {
      setNewPw2(e.target.value);
    }, autoComplete: "new-password" }),
    React.createElement(
      "div",
      { className: "row", style: { marginTop: 12 } },
      React.createElement("button", { onClick: changePassword, disabled: busy }, "修改密码")
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
          React.createElement("th", null, "名称"),
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
                }, disabled: busy || su.busy }, "删除")
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
                  }, disabled: busy }, "删除")
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
function ModelsLockedPage() {
  return React.createElement(
    "div",
    { className: "dshua" },
    React.createElement(
      "div",
      { className: "card" },
      React.createElement("h2", null, "模型配置"),
      React.createElement(
        "div",
        { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 14, lineHeight: "22px" } },
        "该页面仅管理员可访问。模型与 API Key 的配置需要管理员权限，请联系管理员处理。"
      )
    )
  );
}
function injectModelsNavHide() {
  if (typeof document === "undefined") return;
  if (document.querySelector('style[data-plugin-css="dsh-ui-auth-navhide"]') !== null) return;
  var tag = document.createElement("style");
  tag.dataset.plugin = "dsh-ui-auth";
  tag.dataset.pluginCss = "dsh-ui-auth-navhide";
  tag.textContent = '[role="dialog"] nav > div > button:nth-child(2){display:none!important}';
  document.head.appendChild(tag);
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
exports.inject = ["slots"];
exports.apply = function apply(ctx) {
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
      injectModelsNavHide();
      slots.inject("settings.section", function() {
        return slots.register(
          { name: "settings.section", id: "models", order: 10, priority: -1, label: function() {
            return "模型";
          } },
          function() {
            return React.createElement(ModelsLockedPage);
          }
        );
      });
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

