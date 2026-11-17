package de.faresbadawi.tourplan;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/** Tourplan: Web-App in einer Android-Hülle. Links zu Navi-Apps (Waze, Google Maps, MAPS.ME, geo:) öffnen die jeweilige App. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://localhost") || url.startsWith("http://localhost")) return super.shouldOverrideUrlLoading(view, request);
                return openExternal(url);
            }
        });
    }

    /** Öffnet einen Link außerhalb der App; intent://-Links (MAPS.ME) mit Ersatzadresse, falls die App fehlt. */
    private boolean openExternal(String url) {
        try {
            Intent i = url.startsWith("intent:") ? Intent.parseUri(url, Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            try {
                startActivity(i);
            } catch (ActivityNotFoundException e) {
                String fb = i.getStringExtra("browser_fallback_url");
                if (fb != null) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(fb)));
            }
        } catch (Exception ignored) { }
        return true;
    }
}
