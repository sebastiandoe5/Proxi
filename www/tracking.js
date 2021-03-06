/*
    Proxi
 
    Copyright (C) Emux Technologies. All Rights Reserved.
 
    https://emux.app
    Licenced by the Proxi Terms of Service, which can be found at https://emux.app/terms.
*/

const GEOHASH_PRECISION = 10;
const TRACKED_TIMEOUT = 30 * 1000; // 30 seconds
const SPREAD_TIME = 2 * 60 * 1000; // 2 minutes
const PREVIOUS_CONTACT_PERIOD = 7 * 24 * 60 * 60 * 1000; // 1 week
const FAMILY_RESCAN_INTERVAL = 10 * 60 * 1000; // 10 minutes
const SLEEP_TIMEOUT = 10 * 1000; // 10 seconds

var tracking = {
    alertsOn: false,
    currentLocation: {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        nearestDistance: null,
        homeDistance: null
    },
    geolocationWatcher: null,
    aid: null, // Anonymous ID, used to identify user whilst keeping them anonymous
    justAlerted: true,
    alertedSince: null,
    isInfected: false,
    sleepTimeout: null
};

tracking.degreesToRadians = function(degrees) {
    return degrees * (Math.PI / 180);
};

tracking.metresToMiles = function(metres) {
    return metres * 0.000621371192;
};

tracking.calculateDistance = function(lat1, long1, lat2, long2) {
    const EARTH_RADIUS = 6.3781e6; // In metres

    var latChange = tracking.degreesToRadians(lat2 - lat1);
    var longChange = tracking.degreesToRadians(long2 - long1);
    
    var a = Math.pow(Math.sin(latChange / 2), 2) + (
        Math.cos(tracking.degreesToRadians(lat1)) *
        Math.cos(tracking.degreesToRadians(lat2)) *
        Math.pow(Math.sin(longChange / 2), 2)
    );
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return EARTH_RADIUS * c; // In metres
};

tracking.getNearby = function(latitude, longitude, distance, callback) {
    const LATITUDE_METRE = 0.0000089982311916; // Around 1 metre
    var offset = LATITUDE_METRE * distance;

    var lowerLatitude = latitude - offset;
    var upperLatitude = latitude + offset;

    var longitudeOffset = offset * Math.cos(latitude * (Math.PI / 180));
    var lowerLongitude = longitude - longitudeOffset;
    var upperLongitude = longitude + longitudeOffset;

    var lowerGeohash = Geohash.encode(lowerLatitude, lowerLongitude, GEOHASH_PRECISION);
    var upperGeohash = Geohash.encode(upperLatitude, upperLongitude, GEOHASH_PRECISION);

    firebase.database().ref("tracked").orderByChild("loc").startAt(lowerGeohash).endAt(upperGeohash).once("value", function(snapshot) {
        var trackedList = [];
        
        snapshot.forEach(function(childSnapshot) {
            trackedList.push(childSnapshot.val());
            trackedList[trackedList.length - 1]["aid"] = childSnapshot.key;
        });

        callback(trackedList);
    });
};

tracking.sendLocation = function() {
    firebase.database().ref("tracked/" + localStorage.getItem("trackingAid")).set({
        loc: Geohash.encode(
            tracking.currentLocation.latitude,
            tracking.currentLocation.longitude,
            GEOHASH_PRECISION
        ),
        time: firebase.database.ServerValue.TIMESTAMP
    });
};

tracking.knownToInfect = function(raiseAlert = false) {
    firebase.database().ref("users/" + currentUser.uid + "/history").once("value", function(snapshot) {
        snapshot.forEach(function(childSnapshot) {
            if (childSnapshot.key != null) {
                firebase.database().ref("tracked/" + childSnapshot.key + "/wasInfected").set(true);
            }
        });
    });

    if (raiseAlert) {
        if (localStorage.getItem("knownAboutInfection") != "true") {
            screens.switch("infectionAlert");
        }
    }

    localStorage.setItem("knownAboutInfection", "true");
};

tracking.rescanFamily = function(reset = false) {
    if (reset) {
        currentFamilyAids = [];
    }

    for (var i = 0; i < currentFamily.length; i++) {
        firebase.database().ref("users/" + currentFamily[i] + "/aid").once("value", function(snapshot) {
            currentFamilyAids.push(snapshot.val());
        });
    }
};

tracking.changeAlertingRange = function() {
    if (localStorage.getItem("alertingRange") == "6" || localStorage.getItem("alertingRange") == null) {
        localStorage.setItem("alertingRange", "9");
    } else if (localStorage.getItem("alertingRange") == "9") {
        localStorage.setItem("alertingRange", "3");
    } else {
        localStorage.setItem("alertingRange", "6");
    }

    $(".alertingRange").text((localStorage.getItem("alertingRange") || "6") + "m");
}

tracking.start = function() {
    if (!(window.location.href.startsWith("https://") || window.location.href.startsWith("http://"))) { // Features for native version
        window.plugins.insomnia.keepAwake();
    }

    tracking.geolocationWatcher = navigator.geolocation.watchPosition(function(position) {
        tracking.currentLocation.latitude = position.coords.latitude;
        tracking.currentLocation.longitude = position.coords.longitude;
        tracking.currentLocation.accuracy = position.coords.accuracy;

        tracking.currentLocation.homeDistance = tracking.calculateDistance(
            tracking.currentLocation.latitude,
            tracking.currentLocation.longitude,
            localStorage.getItem("homeAddressLatitude"),
            localStorage.getItem("homeAddressLongitude")
        );

        tracking.getNearby(tracking.currentLocation.latitude, tracking.currentLocation.longitude, 20, function(tracked) {
            var nearestDistance = null;
            var nearestAid = null;
            
            for (var i = 0; i < tracked.length; i++) {
                if (new Date().getTime() - tracked[i].time <= TRACKED_TIMEOUT && tracked[i].aid != localStorage.getItem("trackingAid")) {
                    var latitude = Geohash.decode(tracked[i].loc).lat;
                    var longitude = Geohash.decode(tracked[i].loc).lon;
                    var distance = tracking.calculateDistance(
                        tracking.currentLocation.latitude,
                        tracking.currentLocation.longitude,
                        latitude,
                        longitude
                    );

                    if (currentFamilyAids.indexOf(tracked[i].aid) < 0) {
                        if (nearestDistance == null || distance < nearestDistance) {
                            nearestDistance = distance;
                            nearestAid = tracked[i].aid;
                        }
                    }
                }
            }

            if (nearestDistance != null) {
                console.log("Found nearest device, " + nearestDistance + " metres away, AID " + nearestAid);
            }

            if (nearestDistance != null && nearestDistance <= Number(localStorage.getItem("alertingRange") || 6) + 2) {
                console.log("Nearest device within alerting range");

                if (!tracking.justAlerted) {
                    if (tracking.alertsOn) {
                        alerts.fire();

                        console.log("Alert fired");
                    }
                    
                    tracking.alertedSince = new Date().getTime();
                } else {
                    if (new Date().getTime() - tracking.alertedSince <= SPREAD_TIME) {
                        if (localStorage.getItem("inContact") == "" || localStorage.getItem("inContact") == null || localStorage.getItem("inContact").split(",").indexOf(nearestAid) < 0) {
                            localStorage.setItem("inContact", nearestAid);
                        } else {
                            localStorage.setItem("inContact", localStorage.getItem("inContact") + "," + nearestAid);
                        }
                    }
                }

                tracking.justAlerted = true;
            } else {
                tracking.justAlerted = false;
            }

            if (nearestDistance != null && nearestDistance < 10 && localStorage.getItem("trackingAid") != null) {
                firebase.database().ref("users/" + currentUser.uid + "/awards/statistics/beenIn10mContact").set(true);
            }
        });

        if (tracking.currentLocation.homeDistance > 20) {
            if (localStorage.getItem("trackingAid") == null) {
                localStorage.setItem("trackingAid", core.generateKey());
                localStorage.setItem("outSince", String(new Date().getTime()));
                localStorage.setItem("inContact", "");

                firebase.database().ref("users/" + currentUser.uid + "/aid").set(localStorage.getItem("trackingAid")).then(function() {
                    tracking.sendLocation();
                });

                firebase.database().ref("users/" + currentUser.uid + "/outSince").set(new Date().getTime());

                firebase.database().ref("users/" + currentUser.uid + "/awards/statistics/beenIn10mContact").set(null);

                console.log("Assigned AID " + localStorage.getItem("trackingAid"));
            } else {
                tracking.sendLocation();
            }

            $(".homeDistance").text(_("{0} mi from home", [Math.round(tracking.metresToMiles(tracking.currentLocation.homeDistance))]));

            if (localStorage.getItem("outSince") != null) {
                $(".homeOut").text(_("Out for {0} mins", [Math.floor((new Date().getTime() - Number(localStorage.getItem("outSince"))) / 1000 / 60)]));
            } else {
                $(".homeOut").text("");
            }
        } else {
            if (localStorage.getItem("trackingAid") != null) {
                firebase.database().ref("users/" + currentUser.uid + "/aid").set(null);
                firebase.database().ref("users/" + currentUser.uid + "/history/" + localStorage.getItem("trackingAid")).set({
                    time: Number(localStorage.getItem("outSince") || new Date().getTime()),
                    inContact: localStorage.getItem("inContact").split(",")
                });

                firebase.database().ref("tracked/" + localStorage.getItem("inContact").split(",")).on("value", function(snapshot) {
                    if (snapshot.val() != null) {
                        if (snapshot.val().wasInfected == true && new Date().getTime() - snapshot.val().time <= PREVIOUS_CONTACT_PERIOD) {
                            tracking.isInfected = true;

                            tracking.knownToInfect(true);
                        }
                    }
                });

                // Logic for controlling awards

                firebase.database().ref("users/" + currentUser.uid + "/awards/statistics/lastOutside").set(firebase.database.ServerValue.TIMESTAMP);

                awards.judge(new Date().getTime() - Number(localStorage.getItem("outSince")) >= 5 * 60 * 1000 && localStorage.getItem("outSince") != null);

                // Reset local storage

                localStorage.removeItem("trackingAid");
                localStorage.removeItem("outSince");
                localStorage.removeItem("inContact");
            }

            $(".homeDistance").text(_("At home"));
            $(".homeOut").text("");
        }
    }, function() {}, {timeout: 1000, maximumAge: 1000, enableHighAccuracy: true});

    firebase.database().ref("users/" + currentUser.uid + "/history").once("value", function(snapshot) {
        if (snapshot.val() != null) {
            for (var aid in snapshot.val()) {
                var contactAids = snapshot.val()[aid].inContact;

                if (contactAids != null) {
                    for (var i = 0; i < contactAids.length; i++) {
                        firebase.database().ref("tracked/" + contactAids[i]).on("value", function(childSnapshot) {
                            if (childSnapshot.val() != null) {
                                if (childSnapshot.val().wasInfected == true && new Date().getTime() - childSnapshot.val().time <= PREVIOUS_CONTACT_PERIOD) {
                                    tracking.isInfected = true;

                                    tracking.knownToInfect(true);
                                }
                            }
                        });
                    }
                }
            }
        }
    });

    $(".alertingRange").text((localStorage.getItem("alertingRange") || "6") + "m");
};

tracking.stop = function() {
    if (tracking.geolocationWatcher != null) {
        navigator.geolocation.clearWatch(tracking.geolocationWatcher);
    }

    firebase.database().ref("users/" + currentUser.uid + "/aid").set(null);

    if (localStorage.getItem("inContact") != null && localStorage.getItem("inContact") || "") {
        firebase.database().ref("users/" + currentUser.uid + "/history/" + localStorage.getItem("trackingAid")).set({
            time: Number(localStorage.getItem("outSince") || new Date().getTime()),
            inContact: localStorage.getItem("inContact").split(",")
        });
    }

    localStorage.removeItem("trackingAid");
    localStorage.removeItem("outSince");
    localStorage.removeItem("inContact");

    tracking.toggleAlerts(false);

    if (!(window.location.href.startsWith("https://") || window.location.href.startsWith("http://"))) { // Features for native version
        window.plugins.insomnia.allowSleepAgain();
    }
};

tracking.toggleAlerts = function(mode = null) {
    if (mode == null) {
        tracking.alertsOn = !tracking.alertsOn;
    } else {
        tracking.alertsOn = mode.alertsOn;
    }

    if (tracking.alertsOn) {
        $("button.alerts").addClass("selected");
        $("button.alerts").attr("aria-label", _("Turn alerts off"));
        $("p.alertsStatus").text(_("Currently alerting you"));
    } else {
        $("button.alerts").removeClass("selected");
        $("button.alerts").attr("aria-label", _("Turn alerts on"));
        $("p.alertsStatus").text(_("Currently not alerting you"));
    }
};

tracking.sleep = function() {
    if ($("#home").attr("hidden") == null) {
        $("body").addClass("sleep");
    } else {
        $("body").removeClass("sleep");
    }
};

tracking.wake = function() {
    $("body").removeClass("sleep");
};

setInterval(function() {
    tracking.rescanFamily();
}, FAMILY_RESCAN_INTERVAL);

$(function() {
    var noSleepActivated = false;

    $("*").on("click", function() {
        tracking.wake();

        clearInterval(tracking.sleepTimeout);

        tracking.sleepTimeout = setTimeout(tracking.sleep, SLEEP_TIMEOUT);

        if (!noSleepActivated) {
            new NoSleep().enable();
        }
    });

    tracking.sleepTimeout = setTimeout(tracking.sleep, SLEEP_TIMEOUT);
});