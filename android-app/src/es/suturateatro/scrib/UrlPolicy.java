package es.suturateatro.scrib;

import java.net.URI;
import java.util.Locale;

// Pure Java policy, tested without a device. Never send cookies to third parties.
public final class UrlPolicy {
    public static final String START = "https://sutura-gateway.ddns.net/scrib/";
    private UrlPolicy() { }
    private static URI secure(String address) {
        try {
            URI uri = new URI(address);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            return (host.equals("sutura-gateway.ddns.net") || host.equals("sutura.ddns.net")) ? uri : null;
        } catch (Exception ignored) { return null; }
    }
    public static boolean internal(String address) { return secure(address) != null; }
    public static boolean world(String address) {
        URI uri = secure(address);
        if (uri == null || !uri.getHost().equalsIgnoreCase("sutura-gateway.ddns.net")) return false;
        String path = uri.getRawPath();
        return path != null && path.startsWith("/scrib/") && !path.contains("%")
                && !path.contains("..") && !path.contains("\\");
    }
    public static boolean download(String address) {
        return world(address) && newURIPath(address).startsWith("/scrib/backstage/");
    }
    private static String newURIPath(String address) {
        try { return new URI(address).getPath(); } catch (Exception ignored) { return ""; }
    }
    public static boolean external(String address) {
        try {
            String scheme = new URI(address).getScheme();
            return scheme != null && (scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("mailto")
                    || scheme.equalsIgnoreCase("tel") || scheme.equalsIgnoreCase("whatsapp"));
        } catch (Exception ignored) { return false; }
    }
}
