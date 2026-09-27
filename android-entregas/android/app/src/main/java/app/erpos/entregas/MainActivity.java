package app.erpos.entregas;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * App "ERPOS Entregas" (só o portal do motoboy). Mesmo comportamento do app ERPOS
 * (android-app/.../MainActivity.java), sem o microfone do assistente:
 * teclado encolhe a tela e o VOLTAR do Android volta no site em vez de fechar o app.
 * O GPS com a tela apagada vem do plugin @capacitor-community/background-geolocation.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                android.webkit.WebView wv = bridge != null ? bridge.getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
