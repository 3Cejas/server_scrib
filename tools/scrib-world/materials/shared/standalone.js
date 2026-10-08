"use strict";
// The library shell already registers activity; standalone tabs need it too.
if (window.top === window) {
  const script = document.createElement('script');
  script.src = '/scrib/backstage/activity.js?v=1';
  document.head.append(script);
}
