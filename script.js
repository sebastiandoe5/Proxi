/*
    Proxi

    Copyright (C) Emux Technologies. All Rights Reserved.
    https://emux.app
    
    Licenced by the Proxi Terms of Service, which can be found at https://emux.app/terms.
*/

var installPrompt = null;

function installApp() {
    if (installPrompt != null) {
        installPrompt.prompt();

        installPrompt.userChoice.then(function(result) {
            if (result.outcome == "dismissed") {
                screens.moveForward("storefront", "installation");
            }

            installPrompt = null;
        });
    } else {
        screens.moveForward("storefront", "installation");
    }
}

window.addEventListener("beforeinstallprompt", function(event) {
    event.preventDefault();

    installPrompt = event;
});

$(function() {
    if (navigator.userAgent.toLowerCase().indexOf("android") > -1) { // Android
        $(".android").show();
        $(".ios").hide();
    } else {
        $(".android").hide();
        $(".ios").show();
    }
});

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
});

if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(registration) {
            console.log('Service Worker Registered');
      });
    navigator.serviceWorker.ready.then(function(registration) {
       console.log('Service Worker Ready');
    });
}