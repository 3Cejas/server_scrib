package es.suturateatro.scrib;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final int CHOOSE_FILE = 5101, SAVE_FILE = 5102, MAX_FILE = 16 * 1024 * 1024;
    private final Handler handler = new Handler();
    private final AtomicBoolean saving = new AtomicBoolean(false);
    private WebView webView;
    private FrameLayout root, content;
    private LinearLayout shell;
    private View overlay, fullView;
    private TextView status;
    private ProgressBar progress;
    private ValueCallback<Uri[]> chooser;
    private WebChromeClient.CustomViewCallback fullCallback;
    private volatile boolean trustedPage;
    private boolean failed;
    private byte[] pendingBytes;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(16,18,27));
        getWindow().setNavigationBarColor(Color.rgb(16,18,27));
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(16,18,27));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view,insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom); return insets;
            });
        }
        shell = new LinearLayout(this); shell.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(12),0,dp(8),0);
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.scrib_logo);
        bar.addView(logo,new LinearLayout.LayoutParams(dp(38),dp(38)));
        TextView name = text("<SCRI> B",18); name.setTextColor(Color.rgb(55,221,235));
        name.setPadding(dp(9),0,0,0);bar.addView(name,new LinearLayout.LayoutParams(0,dp(48),1));
        Button menu = new Button(this); menu.setText("⋮"); menu.setContentDescription("Opciones de la app");
        menu.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("<SCRI> B · 1.0.0")
                .setItems(new String[]{"Inicio","Recargar","Abrir en navegador"},(dialog,index) -> {
                    if(index==0 && trustedPage) webView.evaluateJavascript("location.hash='#home'",null);
                    else if(index==2) openExternal(UrlPolicy.START);
                    else new AlertDialog.Builder(this).setMessage("Los cambios que no hayas guardado se perderán. ¿Recargar?")
                        .setPositiveButton("Recargar",(d,w) -> loadStart()).setNegativeButton("Cancelar",null).show();
                }).show());
        bar.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(48)));shell.addView(bar);
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);
        shell.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        content = new FrameLayout(this);shell.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        webView = new WebView(this);webView.setBackgroundColor(Color.rgb(16,18,27));content.addView(webView,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout connect = new LinearLayout(this);connect.setOrientation(LinearLayout.VERTICAL);connect.setGravity(Gravity.CENTER);
        connect.setPadding(dp(30),dp(30),dp(30),dp(30));connect.setBackgroundColor(Color.rgb(16,18,27));
        ImageView mark = new ImageView(this);mark.setImageResource(R.drawable.scrib_logo);connect.addView(mark,new LinearLayout.LayoutParams(dp(120),dp(120)));
        status = text("Conectando con <SCRI> B…",18);status.setGravity(Gravity.CENTER);connect.addView(status);
        TextView help = text("Tu sesión de Sutura se mantiene. Si el servidor está apagado, el gateway permite encenderlo.",14);
        help.setGravity(Gravity.CENTER);help.setPadding(0,dp(16),0,dp(16));connect.addView(help);
        Button retry = new Button(this);retry.setText("Reintentar");retry.setOnClickListener(v -> loadStart());connect.addView(retry);
        overlay = connect;content.addView(overlay,new FrameLayout.LayoutParams(-1,-1));
        root.addView(shell,new FrameLayout.LayoutParams(-1,-1));setContentView(root);configureWebView();
        if(saved != null && webView.restoreState(saved) != null) overlay.setVisibility(View.GONE);
        else webView.loadUrl(deepLink(getIntent()));
    }
    private TextView text(String value,int size) { TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.WHITE);t.setGravity(Gravity.CENTER_VERTICAL);return t; }
    private int dp(int n) { return Math.round(n*getResources().getDisplayMetrics().density); }
    private String deepLink(Intent intent) { String u=intent.getDataString();return UrlPolicy.world(u)?u:UrlPolicy.START; }
    private void loadStart() { trustedPage=false;failed=false;status.setText("Conectando con <SCRI> B…");overlay.setVisibility(View.VISIBLE);webView.loadUrl(UrlPolicy.START); }
    private void offline() { failed=true;status.setText("No se ha podido conectar. Tu sesión sigue guardada.");overlay.setVisibility(View.VISIBLE);progress.setVisibility(View.GONE); }
    private void openExternal(String address) {
        if(!UrlPolicy.external(address))return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(address))); }
        catch(ActivityNotFoundException ignored) { Toast.makeText(this,"No hay una app para abrir este enlace.",Toast.LENGTH_LONG).show(); }
    }
    private void configureWebView() {
        WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);s.setBuiltInZoomControls(false);s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString()+" ScribAndroid/1.0.0");
        CookieManager cookies=CookieManager.getInstance();cookies.setAcceptCookie(true);cookies.setAcceptThirdPartyCookies(webView,true);
        webView.addJavascriptInterface(new PdfBridge(),"ScribAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                String address=request.getUrl().toString();if(UrlPolicy.internal(address))return false;
                if(request.isForMainFrame())openExternal(address);return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                trustedPage=false;failed=false;progress.setVisibility(View.VISIBLE);progress.setProgress(10);
            }
            @Override public void onPageFinished(WebView view,String url) {
                trustedPage=UrlPolicy.world(url);cookies.flush();
                if(!failed)overlay.setVisibility(View.GONE);progress.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e) { if(r.isForMainFrame())offline(); }
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse e) { if(r.isForMainFrame()&&e.getStatusCode()>=500)offline(); }
            @Override public void onReceivedSslError(WebView v,SslErrorHandler ssl,SslError e) { ssl.cancel();offline(); }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v,int n) { progress.setProgress(n); }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;
                try { startActivityForResult(params.createIntent(),CHOOSE_FILE); }
                catch(ActivityNotFoundException ignored) { chooser.onReceiveValue(null);chooser=null; }
                return true;
            }
            @Override public void onShowCustomView(View v,CustomViewCallback callback) {
                if(fullView!=null){callback.onCustomViewHidden();return;}
                fullView=v;fullCallback=callback;shell.setVisibility(View.GONE);root.addView(v,new FrameLayout.LayoutParams(-1,-1));
            }
            @Override public void onHideCustomView() { hideFull(); }
        });
        webView.setDownloadListener((address,agent,disposition,mime,length) -> {
            if(!UrlPolicy.download(address)||!trustedPage){Toast.makeText(this,"Este archivo no se puede descargar desde la app.",Toast.LENGTH_LONG).show();return;}
            remoteFile(address,mime);
        });
    }
    private void hideFull() {
        if(fullView==null)return;root.removeView(fullView);fullView=null;shell.setVisibility(View.VISIBLE);
        if(fullCallback!=null){fullCallback.onCustomViewHidden();fullCallback=null;}
    }
    private final class PdfBridge {
        @JavascriptInterface public boolean savePdf(String encoded,String name) {
            if(!trustedPage||encoded==null||encoded.length()>((MAX_FILE+2)/3)*4||!saving.compareAndSet(false,true))return false;
            try {
                byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
                if(bytes.length>MAX_FILE||bytes.length<5||bytes[0]!='%'||bytes[1]!='P'||bytes[2]!='D'||bytes[3]!='F'||bytes[4]!='-')throw new IllegalArgumentException();
                String safe=name==null?"SCRIB-documento.pdf":name.replaceAll("[^A-Za-z0-9._-]","_");
                if(safe.length()>100)safe="SCRIB-documento.pdf";
                final String filename=safe.endsWith(".pdf")?safe:safe+".pdf";
                handler.post(() -> { if(trustedPage)saveFile(bytes,"application/pdf",filename);else saving.set(false); });return true;
            } catch(Exception ignored) { saving.set(false);return false; }
        }
    }
    private void saveFile(byte[] bytes,String mime,String filename) {
        pendingBytes=bytes;
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime).putExtra(Intent.EXTRA_TITLE,filename);
        try { startActivityForResult(intent,SAVE_FILE); }
        catch(ActivityNotFoundException ignored) { pendingBytes=null;saving.set(false);Toast.makeText(this,"No se ha podido abrir el selector de archivos.",Toast.LENGTH_LONG).show(); }
    }
    private void remoteFile(String address,String mime) {
        if(!saving.compareAndSet(false,true))return;
        final String cookie=CookieManager.getInstance().getCookie(address);
        new Thread(() -> {
            HttpURLConnection connection=null;
            try {
                connection=(HttpURLConnection)new URL(address).openConnection();connection.setConnectTimeout(10000);connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(false);if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
                if(connection.getResponseCode()!=200)throw new IllegalStateException();
                String type=connection.getContentType();
                if(type==null||type.contains("text/html")||connection.getContentLengthLong()>MAX_FILE)throw new IllegalStateException();
                ByteArrayOutputStream output=new ByteArrayOutputStream();
                try(InputStream input=connection.getInputStream()) {
                    byte[] buffer=new byte[8192];int count;
                    while((count=input.read(buffer))!=-1){if(output.size()+count>MAX_FILE)throw new IllegalStateException();output.write(buffer,0,count);}
                }
                byte[] bytes=output.toByteArray();String clean=type.split(";",2)[0];
                String filename=clean.equals("application/vnd.android.package-archive")?"SCRIB-Android.apk":
                        "SCRIB-archivo"+(clean.equals("application/pdf")?".pdf":clean.equals("application/zip")?".zip":"");
                handler.post(() -> { if(trustedPage)saveFile(bytes,clean,filename);else saving.set(false); });
            } catch(Exception ignored) { saving.set(false);handler.post(() -> Toast.makeText(this,"No se pudo descargar. Comprueba tu sesión.",Toast.LENGTH_LONG).show()); }
            finally { if(connection!=null)connection.disconnect(); }
        },"scrib-download").start();
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==CHOOSE_FILE&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));chooser=null;}
        if(request==SAVE_FILE) {
            byte[] bytes=pendingBytes;pendingBytes=null;
            if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null) {
                Uri target=data.getData();new Thread(() -> {
                    try(OutputStream output=getContentResolver().openOutputStream(target,"w")) {
                        if(output==null)throw new IllegalStateException();output.write(bytes);
                        handler.post(() -> Toast.makeText(this,"Archivo guardado.",Toast.LENGTH_SHORT).show());
                    } catch(Exception ignored) { handler.post(() -> Toast.makeText(this,"No se pudo guardar el archivo.",Toast.LENGTH_LONG).show()); }
                    finally { saving.set(false); }
                },"scrib-save").start();
            } else saving.set(false);
        }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);trustedPage=false;webView.loadUrl(deepLink(intent)); }
    @Override protected void onSaveInstanceState(Bundle state) { webView.saveState(state);super.onSaveInstanceState(state); }
    @Override protected void onResume() { super.onResume();webView.onResume(); }
    @Override protected void onPause() { CookieManager.getInstance().flush();webView.onPause();super.onPause(); }
    @Override public void onBackPressed() {
        if(fullView!=null){hideFull();return;}
        if(trustedPage)webView.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",value -> {
            if(!"true".equals(value))goBack();
        });else goBack();
    }
    private void goBack() { if(webView.canGoBack())webView.goBack();else moveTaskToBack(true); }
    @Override protected void onDestroy() {
        trustedPage=false;handler.removeCallbacksAndMessages(null);if(chooser!=null)chooser.onReceiveValue(null);
        webView.removeJavascriptInterface("ScribAndroid");webView.destroy();super.onDestroy();
    }
}
