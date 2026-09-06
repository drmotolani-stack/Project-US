/* Our Space — Firebase Cloud Messaging service worker */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDRB-cRm-iX6nXP_5-hF5ACelpqtvx-Bgo",
  authDomain: "project-us-15aa0.firebaseapp.com",
  projectId: "project-us-15aa0",
  storageBucket: "project-us-15aa0.firebasestorage.app",
  messagingSenderId: "77217285858",
  appId: "1:77217285858:web:428597d6ace8c2e55640bb"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Our Space";
  const body = payload.notification?.body || "Something new is waiting for you.";
  self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: payload.fcmOptions?.link || "./" },
    tag: payload.messageId || "our-space"
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";
  event.waitUntil(
    clients.matchAll({type:"window", includeUncontrolled:true}).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
