package es.suturateatro.scrib;
public final class UrlPolicyTest {
  private static void check(boolean value) { if(!value)throw new AssertionError(); }
  public static void main(String[] args) {
    check(UrlPolicy.world(UrlPolicy.START));check(UrlPolicy.world(UrlPolicy.START+"#event/demo"));
    check(UrlPolicy.internal("https://sutura.ddns.net/outpost.goauthentik.io/start"));
    check(!UrlPolicy.world("https://sutura-gateway.ddns.net/impropios/"));
    check(UrlPolicy.download(UrlPolicy.START+"backstage/api/export.zip"));
    for(String bad:new String[]{null,"http://sutura-gateway.ddns.net/scrib/","https://sutura-gateway.ddns.net.evil/scrib/",
      "https://sutura-gateway.ddns.net@evil/scrib/","https://evil@sutura-gateway.ddns.net/scrib/",
      "https://sutura-gateway.ddns.net:444/scrib/","https://sutura-gateway.ddns.net/scrib/../other/",
      "https://sutura-gateway.ddns.net/scrib/%2e%2e/other/","file:///scrib/","javascript:alert(1)","intent://scrib/"})check(!UrlPolicy.world(bad));
    check(UrlPolicy.external("mailto:equipo@example.org"));check(UrlPolicy.external("tel:+34600000000"));
    check(!UrlPolicy.external("file:///etc/passwd"));check(!UrlPolicy.external("javascript:alert(1)"));
    System.out.println("SCRIB URL policy: trusted hosts, deep links, traversal, downloads and external schemes passed.");
  }
}
