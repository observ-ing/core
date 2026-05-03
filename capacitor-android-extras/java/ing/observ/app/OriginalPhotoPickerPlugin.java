package ing.observ.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Picks an image from the gallery and returns the original file bytes —
 * including GPS EXIF — by calling {@link MediaStore#setRequireOriginal} on
 * the picked URI before reading.
 *
 * Why this exists: the standard Capacitor Camera plugin's chooseFromGallery
 * uses Android's sandboxed Photo Picker, which returns a privacy-stripped
 * copy of the file (GPS coordinates zeroed). The only escape hatch is
 * setRequireOriginal + ACCESS_MEDIA_LOCATION, which the upstream plugin
 * does not implement (issues #1074, #2118, #2147 on ionic-team/capacitor-plugins).
 *
 * We use ACTION_PICK against MediaStore.Images.Media.EXTERNAL_CONTENT_URI
 * specifically because that returns a real MediaStore URI
 * (content://media/external/images/media/123) that supports setRequireOriginal.
 * The newer photo picker URIs (content://media/picker/...) are scoped to the
 * picker session and don't.
 */
@CapacitorPlugin(
    name = "OriginalPhotoPicker",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = "media"),
        @Permission(strings = { Manifest.permission.ACCESS_MEDIA_LOCATION }, alias = "mediaLocation")
    }
)
public class OriginalPhotoPickerPlugin extends Plugin {

    @PluginMethod
    public void pickPhoto(PluginCall call) {
        boolean needsMedia = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("media") != PermissionState.GRANTED;
        boolean needsMediaLocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState("mediaLocation") != PermissionState.GRANTED;

        if (needsMedia || needsMediaLocation) {
            requestPermissionForAliases(
                new String[] { "media", "mediaLocation" },
                call,
                "permissionCallback"
            );
            return;
        }
        launchPicker(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        // Continue even if some permissions are denied — we'll surface what we
        // got via the result so the caller can decide what to do (and the JS
        // layer has a geolocation fallback for missing GPS).
        launchPicker(call);
    }

    private void launchPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        intent.setType("image/*");
        startActivityForResult(call, intent, "pickerResult");
    }

    @ActivityCallback
    private void pickerResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject out = new JSObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            JSObject out = new JSObject();
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        try {
            Uri mediaStoreUri = unwrapToMediaStoreUri(uri);
            // Some providers (Google Photos) wrap MediaStore URIs in their own
            // content provider, which isn't exported to us. setRequireOriginal
            // only works against the MediaStore provider directly, so unwrap
            // first when possible.
            Uri readUri;
            if (mediaStoreUri != null
                    && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    && getPermissionState("mediaLocation") == PermissionState.GRANTED) {
                readUri = MediaStore.setRequireOriginal(mediaStoreUri);
            } else {
                readUri = uri;
            }
            ContentResolver resolver = getContext().getContentResolver();
            String mimeType = resolver.getType(uri);
            String filename = queryFilename(resolver, uri);

            try (InputStream input = resolver.openInputStream(readUri)) {
                if (input == null) {
                    call.reject("Could not open input stream");
                    return;
                }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = input.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                }
                String base64 = Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);

                JSObject out = new JSObject();
                out.put("base64", base64);
                out.put("mimeType", mimeType != null ? mimeType : "image/jpeg");
                if (filename != null) {
                    out.put("filename", filename);
                }
                out.put("cancelled", false);
                call.resolve(out);
            }
        } catch (SecurityException e) {
            String diag = "media=" + permissionStateString("media")
                    + ", mediaLocation=" + permissionStateString("mediaLocation");
            call.reject(
                "Permission denied reading photo (" + diag + "): " + e.getMessage(),
                e
            );
        } catch (Exception e) {
            call.reject("Failed to read photo: " + e.getMessage(), e);
        }
    }

    private String permissionStateString(String alias) {
        PermissionState s = getPermissionState(alias);
        return s == null ? "unknown" : s.toString();
    }

    /**
     * Returns the underlying MediaStore URI for a picked content URI, or null
     * if no MediaStore URI can be derived. Direct MediaStore URIs are returned
     * as-is. Wrapper URIs (e.g. Google Photos) sometimes encode the original
     * MediaStore URI as a path segment; we look for that.
     */
    private Uri unwrapToMediaStoreUri(Uri uri) {
        if ("media".equals(uri.getAuthority())) {
            return uri;
        }
        for (String segment : uri.getPathSegments()) {
            if (segment != null && segment.startsWith("content://media/")) {
                Uri inner = Uri.parse(segment);
                if ("media".equals(inner.getAuthority())) {
                    return inner;
                }
            }
        }
        return null;
    }

    private String queryFilename(ContentResolver resolver, Uri uri) {
        String[] projection = { MediaStore.MediaColumns.DISPLAY_NAME };
        try (Cursor c = resolver.query(uri, projection, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
