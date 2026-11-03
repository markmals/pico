// SDK credential commits are synchronous; a queued write is not durable.
// Retain Security's default item ACL instead of granting every executable access.

#import <CoreFoundation/CoreFoundation.h>
#import <Security/Security.h>

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#include <node_api.h>

/** How much of Security's own explanation an error message quotes. */
#define PICO_MESSAGE_BYTES 512

/** Overwrites a buffer in a way the optimiser may not drop, before it is freed. */
static void PicoWipe(char *bytes, size_t length) {
    volatile char *cursor = bytes;
    while (length > 0) {
        *cursor = 0;
        cursor += 1;
        length -= 1;
    }
}

// InteractionRequired can mean a locked Keychain or a missing access grant.
// It does not establish lock state.
static const char *PicoErrorCode(OSStatus status) {
    switch (status) {
        case errSecInteractionNotAllowed:
        case errSecInteractionRequired:
            return "KEYCHAIN_UI_REQUIRED";
        case errSecNotAvailable:
        case errSecNoSuchKeychain:
        case errSecInvalidKeychain:
        case errSecReadOnly:
            return "KEYCHAIN_LOCKED";
        case errSecAuthFailed:
        case errSecUserCanceled:
        case errSecMissingEntitlement:
            return "KEYCHAIN_ACCESS_DENIED";
        default:
            return "KEYCHAIN_FAILED";
    }
}

typedef struct {
    Boolean previous;
} PicoInteraction;

static pthread_mutex_t PicoInteractionLock = PTHREAD_MUTEX_INITIALIZER;

// The file-based SecItem shim ignores LAContext UI policy. Scope its legacy
// process policy instead; restore it before returning, including failed calls.
static OSStatus PicoBeginInteraction(bool allowUI, PicoInteraction *interaction) {
    pthread_mutex_lock(&PicoInteractionLock);
    OSStatus status = SecKeychainGetUserInteractionAllowed(&interaction->previous);
    if (status == errSecSuccess) {
        status = SecKeychainSetUserInteractionAllowed(allowUI);
    }
    if (status != errSecSuccess) pthread_mutex_unlock(&PicoInteractionLock);
    return status;
}

static OSStatus PicoEndInteraction(const PicoInteraction *interaction, OSStatus result) {
    OSStatus restored = SecKeychainSetUserInteractionAllowed(interaction->previous);
    pthread_mutex_unlock(&PicoInteractionLock);
    return restored == errSecSuccess ? result : restored;
}

/** Throws an error naming the operation, its code and its OSStatus, and never the payload. */
static void PicoThrowStatus(napi_env env, const char *operation, OSStatus status) {
    char explanation[PICO_MESSAGE_BYTES];
    explanation[0] = '\0';
    CFStringRef copied = SecCopyErrorMessageString(status, NULL);
    if (copied != NULL) {
        CFStringGetCString(copied, explanation, sizeof explanation, kCFStringEncodingUTF8);
        CFRelease(copied);
    }

    char message[PICO_MESSAGE_BYTES * 2];
    snprintf(message, sizeof message, "keychain %s failed with OSStatus %d%s%s", operation,
             (int)status, explanation[0] == '\0' ? "" : ": ", explanation);

    napi_value code = NULL;
    napi_value text = NULL;
    napi_value error = NULL;
    if (napi_create_string_utf8(env, PicoErrorCode(status), NAPI_AUTO_LENGTH, &code) != napi_ok) return;
    if (napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text) != napi_ok) return;
    if (napi_create_error(env, code, text, &error) != napi_ok) return;

    napi_value osstatus = NULL;
    if (napi_create_int32(env, (int32_t)status, &osstatus) == napi_ok) {
        napi_set_named_property(env, error, "status", osstatus);
    }
    napi_throw(env, error);
}

/** Copies a string argument into a fresh NUL-terminated buffer, or throws and returns NULL. */
static char *PicoCopyString(napi_env env, napi_value value, const char *what, size_t *length) {
    size_t size = 0;
    if (napi_get_value_string_utf8(env, value, NULL, 0, &size) != napi_ok) {
        napi_throw_type_error(env, NULL, what);
        return NULL;
    }
    char *bytes = malloc(size + 1);
    if (bytes == NULL) {
        napi_throw_error(env, "KEYCHAIN_FAILED", "out of memory copying a keychain argument");
        return NULL;
    }
    size_t copied = 0;
    if (napi_get_value_string_utf8(env, value, bytes, size + 1, &copied) != napi_ok) {
        PicoWipe(bytes, size + 1);
        free(bytes);
        napi_throw_type_error(env, NULL, what);
        return NULL;
    }
    *length = copied;
    return bytes;
}

static CFStringRef PicoCopyCFString(const char *bytes, size_t length) {
    return CFStringCreateWithBytes(kCFAllocatorDefault, (const UInt8 *)bytes, (CFIndex)length,
                                   kCFStringEncodingUTF8, false);
}

/** The item one call addresses, plus whether that call may let the OS ask the human. */
typedef struct {
    CFStringRef service;
    CFStringRef account;
    bool allowUI;
} PicoTarget;

static bool PicoReadTarget(napi_env env, napi_value service, napi_value account,
                           napi_value allowUI, PicoTarget *target) {
    size_t serviceLength = 0;
    char *serviceBytes =
        PicoCopyString(env, service, "the keychain service must be a string", &serviceLength);
    if (serviceBytes == NULL) return false;

    size_t accountLength = 0;
    char *accountBytes =
        PicoCopyString(env, account, "the keychain account must be a string", &accountLength);
    if (accountBytes == NULL) {
        free(serviceBytes);
        return false;
    }

    target->service = PicoCopyCFString(serviceBytes, serviceLength);
    target->account = PicoCopyCFString(accountBytes, accountLength);
    free(serviceBytes);
    free(accountBytes);
    if (target->service == NULL || target->account == NULL) {
        if (target->service != NULL) CFRelease(target->service);
        if (target->account != NULL) CFRelease(target->account);
        napi_throw_error(env, "KEYCHAIN_FAILED", "a keychain argument is not valid UTF-8");
        return false;
    }

    // Anything but an explicit `true` leaves the dialog forbidden: failing without the OS
    // asking is the default every ordinary agent path depends on.
    target->allowUI = false;
    napi_get_value_bool(env, allowUI, &target->allowUI);
    return true;
}

static void PicoReleaseTarget(PicoTarget *target) {
    CFRelease(target->service);
    CFRelease(target->account);
}

/**
 * The attributes naming one Pico item.
 *
 * `kSecAttrSynchronizable` is absent on purpose: setting it at all moves the query to the
 * data-protection keychain, and these items belong in the login Keychain, unsynchronized.
 */
static CFMutableDictionaryRef PicoItemQuery(const PicoTarget *target) {
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, target->service);
    CFDictionarySetValue(query, kSecAttrAccount, target->account);
    return query;
}

/** Reads `argc` arguments, throwing when the bridge is called with fewer than it needs. */
static bool PicoArguments(napi_env env, napi_callback_info info, size_t expected, napi_value *argv) {
    size_t argc = expected;
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) return false;
    if (argc < expected) {
        napi_throw_type_error(env, NULL, "pico's keychain bridge needs service, account and flag arguments");
        return false;
    }
    return true;
}

/** `get(service, account, allowUI)`: the payload, or null when there is no such item. */
static napi_value PicoGet(napi_env env, napi_callback_info info) {
    napi_value argv[3];
    if (!PicoArguments(env, info, 3, argv)) return NULL;
    PicoTarget target;
    if (!PicoReadTarget(env, argv[0], argv[1], argv[2], &target)) return NULL;

    CFMutableDictionaryRef query = PicoItemQuery(&target);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

    CFTypeRef found = NULL;
    PicoInteraction interaction;
    OSStatus status = PicoBeginInteraction(target.allowUI, &interaction);
    if (status == errSecSuccess) {
        status = SecItemCopyMatching(query, &found);
        status = PicoEndInteraction(&interaction, status);
    }
    CFRelease(query);
    PicoReleaseTarget(&target);

    if (status == errSecItemNotFound) {
        napi_value missing = NULL;
        napi_get_null(env, &missing);
        return missing;
    }
    if (status != errSecSuccess) {
        if (found != NULL) CFRelease(found);
        PicoThrowStatus(env, "get", status);
        return NULL;
    }
    if (found == NULL || CFGetTypeID(found) != CFDataGetTypeID()) {
        if (found != NULL) CFRelease(found);
        napi_throw_error(env, "KEYCHAIN_FAILED",
                         "the keychain returned no password data for a generic password item");
        return NULL;
    }

    CFDataRef data = (CFDataRef)found;
    const UInt8 *bytes = CFDataGetBytePtr(data);
    const char *text = bytes == NULL ? "" : (const char *)bytes;
    size_t length = bytes == NULL ? 0 : (size_t)CFDataGetLength(data);
    napi_value payload = NULL;
    napi_status created = napi_create_string_utf8(env, text, length, &payload);
    CFRelease(found);
    if (created != napi_ok) {
        napi_throw_error(env, "KEYCHAIN_FAILED", "the stored payload could not be read as text");
        return NULL;
    }
    return payload;
}

/** `set(service, account, payload, allowUI)`: durable before it returns. */
static napi_value PicoSet(napi_env env, napi_callback_info info) {
    napi_value argv[4];
    if (!PicoArguments(env, info, 4, argv)) return NULL;

    size_t payloadLength = 0;
    char *payloadBytes =
        PicoCopyString(env, argv[2], "the keychain payload must be a string", &payloadLength);
    if (payloadBytes == NULL) return NULL;

    PicoTarget target;
    if (!PicoReadTarget(env, argv[0], argv[1], argv[3], &target)) {
        PicoWipe(payloadBytes, payloadLength);
        free(payloadBytes);
        return NULL;
    }

    CFDataRef payload =
        CFDataCreate(kCFAllocatorDefault, (const UInt8 *)payloadBytes, (CFIndex)payloadLength);
    PicoWipe(payloadBytes, payloadLength);
    free(payloadBytes);
    if (payload == NULL) {
        PicoReleaseTarget(&target);
        napi_throw_error(env, "KEYCHAIN_FAILED", "out of memory copying the keychain payload");
        return NULL;
    }

    CFMutableDictionaryRef query = PicoItemQuery(&target);
    CFMutableDictionaryRef replacement = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(replacement, kSecValueData, payload);

    // Updating first keeps an existing item's identity and access control, which is what a
    // refreshed grant needs. Adding happens only when there is nothing to update, and a writer
    // that lost the race to add updates the winner's item rather than failing.
    PicoInteraction interaction;
    OSStatus status = PicoBeginInteraction(target.allowUI, &interaction);
    if (status == errSecSuccess) {
        status = SecItemUpdate(query, replacement);
        if (status == errSecItemNotFound) {
            CFMutableDictionaryRef addition =
                CFDictionaryCreateMutableCopy(kCFAllocatorDefault, 0, query);
            CFDictionarySetValue(addition, kSecValueData, payload);
            CFDictionarySetValue(addition, kSecAttrLabel, target.service);
            status = SecItemAdd(addition, NULL);
            CFRelease(addition);
            if (status == errSecDuplicateItem) status = SecItemUpdate(query, replacement);
        }
        status = PicoEndInteraction(&interaction, status);
    }

    CFRelease(replacement);
    CFRelease(query);
    CFRelease(payload);
    PicoReleaseTarget(&target);

    if (status != errSecSuccess) PicoThrowStatus(env, "set", status);
    return NULL;
}

/** `delete(service, account, allowUI)`: true when an item was removed, false when none was. */
static napi_value PicoDelete(napi_env env, napi_callback_info info) {
    napi_value argv[3];
    if (!PicoArguments(env, info, 3, argv)) return NULL;
    PicoTarget target;
    if (!PicoReadTarget(env, argv[0], argv[1], argv[2], &target)) return NULL;

    CFMutableDictionaryRef query = PicoItemQuery(&target);
    PicoInteraction interaction;
    OSStatus status = PicoBeginInteraction(target.allowUI, &interaction);
    if (status == errSecSuccess) {
        status = SecItemDelete(query);
        status = PicoEndInteraction(&interaction, status);
    }
    CFRelease(query);
    PicoReleaseTarget(&target);

    if (status != errSecSuccess && status != errSecItemNotFound) {
        PicoThrowStatus(env, "delete", status);
        return NULL;
    }

    napi_value deleted = NULL;
    napi_get_boolean(env, status == errSecSuccess, &deleted);
    return deleted;
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor operations[] = {
        {"get", NULL, PicoGet, NULL, NULL, NULL, napi_default, NULL},
        {"set", NULL, PicoSet, NULL, NULL, NULL, napi_default, NULL},
        {"delete", NULL, PicoDelete, NULL, NULL, NULL, napi_default, NULL},
    };
    size_t count = sizeof operations / sizeof operations[0];
    if (napi_define_properties(env, exports, count, operations) != napi_ok) return NULL;
    return exports;
}
