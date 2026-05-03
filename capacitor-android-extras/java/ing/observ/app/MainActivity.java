package ing.observ.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OriginalPhotoPickerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
