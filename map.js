(function () {
  "use strict";

  var MODES = {
    MARKERS: "markers",
    HEAT: "heat",
    DENSITY: "density"
  };

  var MAP_CONFIG = {
    center: [-32.95, -60.66],
    zoom: 11,
    markerCluster: {
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: true,
      showCoverageOnHover: false,
      maxClusterRadius: 45
    },
    heat: {
      radius: 22,
      blur: 14,
      maxZoom: 14,
      minOpacity: 0.3,
      gradient: {
        0.2: "blue",
        0.4: "lime",
        0.6: "yellow",
        0.8: "orange",
        1.0: "red"
      }
    }
  };

  var ui = {
    yearFilter: document.getElementById("yearFilter"),
    counter: document.getElementById("counter"),
    markerBtn: document.getElementById("markerBtn"),
    heatBtn: document.getElementById("heatBtn"),
    densityBtn: document.getElementById("densityBtn")
  };

  var state = {
    mode: MODES.MARKERS,
    events: [],
    barriosGeoJSON: null,
    barriosLayer: null
  };

  var map = L.map("map").setView(MAP_CONFIG.center, MAP_CONFIG.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  var markerClusterLayer = L.markerClusterGroup(MAP_CONFIG.markerCluster);
  var heatLayer = L.heatLayer([], MAP_CONFIG.heat);

  map.addLayer(markerClusterLayer);

  function valueOrNA(value) {
    return value === null || value === undefined || value === "" ? "N/A" : value;
  }

  function buildEventPopup(event) {
    return [
      '<div class="popup-card">',
      '  <div class="popup-title">' + valueOrNA(event.source_headline || event.description) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Event ID:</span> ' + valueOrNA(event.event_id) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Date:</span> ' + valueOrNA(event.date) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Year:</span> ' + valueOrNA(event.year) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Location:</span> ' + valueOrNA(event.location) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Dyad:</span> ' + valueOrNA(event.dyad) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Type of violence:</span> ' + valueOrNA(event.type) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Fatalities:</span> ' + valueOrNA(event.fatalities) + "</div>",
      '  <div class="popup-row"><span class="popup-label">Civilian deaths:</span> ' + valueOrNA(event.deaths_civilians) + "</div>",
      '  <div class="popup-source"><span class="popup-label">Source:</span> ' + valueOrNA(event.source) + "</div>",
      "</div>"
    ].join("\n");
  }

  function getDensityColor(count) {
    if (count > 30) return "#800026";
    if (count > 20) return "#BD0026";
    if (count > 10) return "#E31A1C";
    if (count > 5) return "#FC4E2A";
    if (count > 2) return "#FD8D3C";
    if (count > 0) return "#FEB24C";
    return "#222";
  }

  function pointInPolygon(point, polygon) {
    var x = point[0];
    var y = point[1];
    var inside = false;

    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var xi = polygon[i][0];
      var yi = polygon[i][1];
      var xj = polygon[j][0];
      var yj = polygon[j][1];

      var intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  function isInsideGeometry(point, geometry) {
    if (!geometry) return false;

    if (geometry.type === "Polygon") {
      return pointInPolygon(point, geometry.coordinates[0]);
    }

    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some(function (polygon) {
        return pointInPolygon(point, polygon[0]);
      });
    }

    return false;
  }

  function getBarrioName(feature) {
    var properties = (feature && feature.properties) || {};

    return (
      properties.BARRIO ||
      properties.barrio ||
      properties.NOMBRE ||
      properties.nombre ||
      properties.name ||
      "Unnamed neighbourhood"
    );
  }

  function resetRenderableLayers() {
    markerClusterLayer.clearLayers();

    if (map.hasLayer(markerClusterLayer)) {
      map.removeLayer(markerClusterLayer);
    }

    if (map.hasLayer(heatLayer)) {
      map.removeLayer(heatLayer);
    }

    if (state.barriosLayer && map.hasLayer(state.barriosLayer)) {
      map.removeLayer(state.barriosLayer);
    }
  }

  function getFilteredEvents(year) {
    return state.events.filter(function (event) {
      var lat = Number(event.lat);
      var lng = Number(event.lng);
      var hasCoordinates = !Number.isNaN(lat) && lat !== 0 && !Number.isNaN(lng) && lng !== 0;

      if (!hasCoordinates || !event.year) {
        return false;
      }

      return year === "all" || String(event.year) === String(year);
    });
  }

  function renderMarkers(events) {
    events.forEach(function (event) {
      var marker = L.marker([Number(event.lat), Number(event.lng)]).bindPopup(buildEventPopup(event));
      markerClusterLayer.addLayer(marker);
    });

    map.addLayer(markerClusterLayer);
  }

  function renderHeatmap(events) {
    var points = events.map(function (event) {
      var fatalities = Number(event.fatalities) || 1;
      return [Number(event.lat), Number(event.lng), Math.min(fatalities, 3)];
    });

    heatLayer.setLatLngs(points);
    map.addLayer(heatLayer);
  }

  function calculateBarrioCounts(events) {
    if (!state.barriosGeoJSON) return {};

    var counts = {};

    state.barriosGeoJSON.features.forEach(function (feature) {
      counts[getBarrioName(feature)] = 0;
    });

    events.forEach(function (event) {
      var point = [Number(event.lng), Number(event.lat)];

      state.barriosGeoJSON.features.forEach(function (feature) {
        if (isInsideGeometry(point, feature.geometry)) {
          counts[getBarrioName(feature)] += 1;
        }
      });
    });

    return counts;
  }

  function renderDensity(events) {
    if (!state.barriosGeoJSON) return;

    var counts = calculateBarrioCounts(events);

    state.barriosLayer = L.geoJSON(state.barriosGeoJSON, {
      style: function (feature) {
        var count = counts[getBarrioName(feature)] || 0;

        return {
          fillColor: getDensityColor(count),
          weight: 1,
          color: "#444",
          fillOpacity: count > 0 ? 0.72 : 0.18
        };
      },
      onEachFeature: function (feature, layer) {
        var name = getBarrioName(feature);
        var count = counts[name] || 0;

        layer.bindPopup(
          '<div class="popup-card">' +
            '<div class="popup-title">' +
            name +
            "</div>" +
            '<div class="popup-row"><span class="popup-label">Events:</span> ' +
            count +
            "</div>" +
            "</div>"
        );
      }
    });

    map.addLayer(state.barriosLayer);
  }

  function updateCounter(count) {
    ui.counter.innerText = "Events displayed: " + count;
  }

  function renderCurrentMode(events) {
    if (state.mode === MODES.MARKERS) {
      renderMarkers(events);
      return;
    }

    if (state.mode === MODES.HEAT) {
      renderHeatmap(events);
      return;
    }

    if (state.mode === MODES.DENSITY) {
      renderDensity(events);
    }
  }

  function updateMap() {
    var selectedYear = ui.yearFilter.value;
    var filteredEvents = getFilteredEvents(selectedYear);

    resetRenderableLayers();
    renderCurrentMode(filteredEvents);
    updateCounter(filteredEvents.length);
  }

  function setMode(nextMode) {
    state.mode = nextMode;

    ui.markerBtn.classList.toggle("active", nextMode === MODES.MARKERS);
    ui.heatBtn.classList.toggle("active", nextMode === MODES.HEAT);
    ui.densityBtn.classList.toggle("active", nextMode === MODES.DENSITY);

    updateMap();
  }

  function attachEventHandlers() {
    ui.yearFilter.addEventListener("change", updateMap);
    ui.markerBtn.addEventListener("click", function () {
      setMode(MODES.MARKERS);
    });
    ui.heatBtn.addEventListener("click", function () {
      setMode(MODES.HEAT);
    });
    ui.densityBtn.addEventListener("click", function () {
      setMode(MODES.DENSITY);
    });
  }

  function loadDatasets() {
    var eventsRequest = fetch("data.json").then(function (response) {
      return response.json();
    });

    var barriosRequest = fetch("barrios.geojson")
      .then(function (response) {
        return response.json();
      })
      .catch(function () {
        return null;
      });

    Promise.all([eventsRequest, barriosRequest]).then(function (results) {
      state.events = results[0] || [];
      state.barriosGeoJSON = results[1];
      updateMap();
    });
  }

  attachEventHandlers();
  loadDatasets();
})();
