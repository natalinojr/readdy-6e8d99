package app.erpos.gestao;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import com.getcapacitor.CapacitorWebView;

/**
 * WebView do ERPOS.
 *
 * Existe por um motivo só: tirar o "editor em tela cheia" do teclado (extract UI). Sem as marcas
 * abaixo, o teclado do Samsung cobre a tela com uma caixa de texto própria ("Mensagem — Fechar —
 * OK") em vez de digitar direto no chat (visto em 16/09/2026). App nativo declara isso no campo;
 * dentro do WebView é preciso declarar aqui.
 *
 * Entra no lugar do CapacitorWebView porque o app sobrepõe o layout da biblioteca
 * (res/layout/capacitor_bridge_layout_main.xml, mesmo nome = o do app vence).
 */
public class ErposWebView extends CapacitorWebView {

    public ErposWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection ic = super.onCreateInputConnection(outAttrs);
        if (outAttrs != null) {
            outAttrs.imeOptions |= EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_FULLSCREEN;
        }
        return ic;
    }
}
