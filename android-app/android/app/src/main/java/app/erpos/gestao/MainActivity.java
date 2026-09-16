package app.erpos.gestao;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Áudio do chat do assistente (MediaRecorder dentro do WebView). RECORD_AUDIO é permissão
    // "perigosa": não basta estar no AndroidManifest, o app precisa PEDIR ao usuário. Sem isso o
    // getUserMedia falhava calado e o microfone não gravava (2026-09-15).
    private static final int PEDIDO_MICROFONE = 4101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Tela encolhe quando o teclado abre (também no AndroidManifest). Sem isso o Android acha
        // que falta espaço e o teclado abre o "editor em tela cheia" por cima do app.
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, PEDIDO_MICROFONE);
        }
        // O WebView pede a própria autorização de microfone por cima da permissão do Android:
        // com a permissão concedida, libera na hora em vez de recusar sem avisar.
        this.bridge.getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean soAudio = true;
                for (String r : request.getResources()) {
                    if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) soAudio = false;
                }
                if (soAudio && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                    return;
                }
                super.onPermissionRequest(request);
            }
        });
    }
}
