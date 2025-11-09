import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
  OnDestroy
} from "@angular/core";

import esri = __esri; // Esri TypeScript Types

import Config from '@arcgis/core/config';
import WebMap from '@arcgis/core/WebMap';
import MapView from '@arcgis/core/views/MapView';
import Bookmarks from '@arcgis/core/widgets/Bookmarks';
import Expand from '@arcgis/core/widgets/Expand';

import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';

import FeatureLayer from '@arcgis/core/layers/FeatureLayer';

import FeatureSet from '@arcgis/core/rest/support/FeatureSet';
import RouteParameters from '@arcgis/core/rest/support/RouteParameters';
import * as route from "@arcgis/core/rest/route.js";

import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';

import * as locator from "@arcgis/core/rest/locator.js";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils.js";

import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import Search from '@arcgis/core/widgets/Search';
import { FirebaseService } from '../../services/firebase.service';


@Component({
  selector: "app-map",
  templateUrl: "./map.component.html",
  styleUrls: ["./map.component.scss"]
})
export class MapComponent implements OnInit, OnDestroy {
  @Output() mapLoadedEvent = new EventEmitter<boolean>();

  @ViewChild("mapViewNode", { static: true }) private mapViewEl: ElementRef;

  map: esri.Map;
  view: esri.MapView;
  graphicsLayer: esri.GraphicsLayer;
  graphicsLayerUserPoints: esri.GraphicsLayer;
  graphicsLayerRoutes: esri.GraphicsLayer;
  trailheadsLayer: esri.FeatureLayer;

  placesLayer: esri.GraphicsLayer;
  selectedCategory: string = "Parks and Outdoors";
  locatorUrl: string = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";

  placeCategories = [
    "Parks and Outdoors",
    "Coffee shop",
    "Gas station",
    "Food",
    "Hotel"
  ];

  zoom = 10;
  center: Array<number> = [-118.73682450024377, 34.07817583063242];
  basemap = "streets-vector";
  loaded = false;
  directionsElement: any;

  constructor(private fb: FirebaseService) { }
  private firebaseUnsubscribe: (() => void) | null = null;
  private userPosUnsubscribe: (() => void) | null = null;
  private clientId: string = 'client_' + Math.random().toString(36).substr(2, 9);
  private lastCenterSent: number = 0;
  private centerSyncTimer: any = null;
  graphicsLayerFirebase: esri.GraphicsLayer;

  ngOnInit() {
    this.initializeMap().then(() => {
      this.loaded = this.view.ready;
      this.mapLoadedEvent.emit(true);
    });
  }

  async initializeMap() {
    try {
      Config.apiKey = "AAPTxy8BH1VEsoebNVZXo8HurNkC1Sdwhs4Cf4CtpFSU2ZtkE-gr2kF3_v5hERT8Pn5ixBxa8RtJj5lKaIuchW3sGII4D0BMp_qmbMnWbsFOKFGQTcehoor1nLMh7Wq5rVDR2rufeaE8vCRp4wZw7FwuYmExQBE3tikw1-TOhZDpp8C-wikKdoyZRD9FhdV2hNJ-oWT3J2f35_KMfqLAaL1tmA1JmdOkv1IXrMRqh_lxnHM.AT1_vEVLXOc7";

      const mapProperties: esri.WebMapProperties = {
        basemap: this.basemap
      };
      this.map = new WebMap(mapProperties);

      this.addFeatureLayers();
      this.addGraphicsLayer();
      this.addGraphicElements();

      const mapViewProperties = {
        container: this.mapViewEl.nativeElement,
        center: this.center,
        zoom: this.zoom,
        map: this.map
      };
      this.view = new MapView(mapViewProperties);

      this.view.on('pointer-move', ["Shift"], (event) => {
        const point = this.view.toMap({ x: event.x, y: event.y });
        console.log("Map pointer moved: ", point.longitude, point.latitude);
      });

      await this.view.when();
      console.log("ArcGIS map loaded");
    this.setupFirebaseSync();
      this.addRouting();
      this.setupPlaceSearch();
      this.addSearchWidget();
      return this.view;
    } catch (error) {
      console.error("Error loading the map: ", error);
      alert("Error loading the map");
    }
  }

  setupPlaceSearch() {
    reactiveUtils.when(
      () => this.view.stationary === true,
      () => {
        if (this.view.extent) {
          this.findPlaces(this.selectedCategory, this.view.center);
        }
      }
    );
  }

  addSearchWidget() {
    const search = new Search({
      view: this.view,
      popupEnabled: true
    });

    this.view.ui.add(search, "top-right");
  }


  async findPlaces(category: string, point: esri.Point) {
    const results = await locator.addressToLocations(this.locatorUrl, {
      address: {},
      location: point,
      categories: [category],
      maxLocations: 25,
      outFields: ["Place_addr", "PlaceName"]
    });

    this.placesLayer.removeAll();

    const symbol = new SimpleMarkerSymbol({
      color: "#000000",
      size: 10,
      outline: { color: "#ffffff", width: 1 }
    });

    results.forEach(result => {
      const placeGraphic = new Graphic({
        geometry: result.location,
        attributes: result.attributes,
        symbol,
        popupTemplate: {
          title: "{PlaceName}",
          content: "{Place_addr}"
        }
      });

      this.view.on("click", (event) => {
        if (event.mapPoint && event.mapPoint.latitude === result.location.latitude && event.mapPoint.longitude === result.location.longitude) {
          if (this.graphicsLayerUserPoints.graphics.length === 2) {
            this.removeRoutes();
            this.removePoints();
          }
          this.addPoint(result.location.latitude, result.location.longitude);
          if (this.graphicsLayerUserPoints.graphics.length === 2) {
            this.calculateRoute("https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World");
          }
        }
      });

      this.placesLayer.add(placeGraphic);
    });
  }


  changeCategory(category: string) {
    this.selectedCategory = category;
    if (this.view && this.view.center) {
      this.findPlaces(category, this.view.center);
    }
  }

  clearPlaces() {
    this.placesLayer.removeAll();
    console.log("Places cleared");
  }

  addGraphicElements() {
    const point = new Point({
      longitude: -118.80657463861,
      latitude: 34.0005930608889,
    });

    const simpleMarkerSymbol = {
      type: "simple-marker",
      color: [226, 119, 40],
      outline: {
        color: [255, 255, 255],
        width: 1,
      },
    };

    const pointGraphic = new Graphic({
      geometry: point,
      symbol: simpleMarkerSymbol as any
    });
    this.graphicsLayer.add(pointGraphic);

    const polyline = new Polyline({
      paths: [
        [
          [-118.821527826096, 34.0139576938577],
          [-118.814893761649, 34.0080602407843],
          [-118.808878330345, 34.0016642996246]
        ]
      ]
    });

    const simpleLineSymbol = {
      type: "simple-line",
      color: [226, 119, 40],
      width: 2,
    };

    const polylineGraphic = new Graphic({
      geometry: polyline,
      symbol: simpleLineSymbol as   any,
    });
    this.graphicsLayer.add(polylineGraphic);

    const polygon = new Polygon({
      rings: [
        [
          [-118.818984489994, 34.0137559967283],
          [-118.806796597377, 34.0215816298725],
          [-118.791432890735, 34.0163883241613],
          [-118.79596686535, 34.008564864635],
          [-118.808558110679, 34.0035027131376],
          [-118.818984489994, 34.0137559967283]
        ]
      ],
    });

    const simpleFillSymbol = {
      type: "simple-fill",
      color: [227, 139, 79, 0.8],
      outline: {
        color: [255, 255, 255],
        width: 1
      },
    };

    const polygonGraphic = new Graphic({
      geometry: polygon,
      symbol: simpleFillSymbol as any ,
    });
    this.graphicsLayer.add(polygonGraphic);

    console.log("Lab 02 graphics added: point, polyline, and polygon");
  }

  toggleGraphics() {
    this.graphicsLayer.visible = !this.graphicsLayer.visible;
    console.log("Graphics visibility:", this.graphicsLayer.visible);
  }

  addFeatureLayers() {
    this.trailheadsLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trailheads/FeatureServer/0",
      outFields: ['*']
    });
    this.map.add(this.trailheadsLayer);

    const trailsLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trails/FeatureServer/0"
    });
    this.map.add(trailsLayer, 0);

    const parksLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Parks_and_Open_Space/FeatureServer/0"
    });
    this.map.add(parksLayer, 0);

    console.log("Feature layers added");
  }

  addGraphicsLayer() {
    this.graphicsLayer = new GraphicsLayer();
    this.map.add(this.graphicsLayer);

    this.graphicsLayerUserPoints = new GraphicsLayer();
    this.map.add(this.graphicsLayerUserPoints);

    this.graphicsLayerRoutes = new GraphicsLayer();
    this.map.add(this.graphicsLayerRoutes);

    this.placesLayer = new GraphicsLayer({ title: "Places" });
    this.map.add(this.placesLayer);
    this.graphicsLayerFirebase = new GraphicsLayer({ title: 'Firebase Points' });
    this.map.add(this.graphicsLayerFirebase);
  }

  addRouting() {
    const routeUrl = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
    this.view.on("click", (event) => {
      const point = event.mapPoint;
      if (!point) return;

      if (this.graphicsLayerUserPoints.graphics.length === 2) {
        this.removeRoutes();
        this.removePoints();
      }
      this.addPoint(point.latitude, point.longitude);
      this.addPointToFirebase(point.latitude, point.longitude);

      if (this.graphicsLayerUserPoints.graphics.length === 2) {
        this.calculateRoute(routeUrl);
      }
    });
  }

  addPointToFirebase(lat: number, lng: number) {
    try {
      this.fb.addPoint({ lat, lng, clientId: this.clientId });
    } catch (err) {
      console.error('Error pushing point to Firebase', err);
    }
  }

  addPoint(lat: number, lng: number) {
    let point = new Point({
      longitude: lng,
      latitude: lat
    });

    const simpleMarkerSymbol = {
      type: "simple-marker",
      color: [226, 119, 40],  // Orange
      outline: {
        color: [255, 255, 255], // White
        width: 1
      }
    };

    let pointGraphic: esri.Graphic = new Graphic({
      geometry: point,
      symbol: simpleMarkerSymbol
    });

    this.graphicsLayerUserPoints.add(pointGraphic);
  }

  removePoints() {
    this.graphicsLayerUserPoints.removeAll();
  }

  removeRoutes() {
    this.graphicsLayerRoutes.removeAll();
  }

  async calculateRoute(routeUrl: string) {
    const routeParams = new RouteParameters({
      stops: new FeatureSet({
        features: this.graphicsLayerUserPoints.graphics.toArray()
      }),
      returnDirections: true
    });

    try {
      const data = await route.solve(routeUrl, routeParams);
      this.displayRoute(data);
    } catch (error) {
      console.error("Error calculating route: ", error);
      alert("Error calculating route");
    }
  }

  displayRoute(data: any) {
    for (const result of data.routeResults) {
      result.route.symbol = {
        type: "simple-line",
        color: [5, 150, 255],
        width: 3
      };
      this.graphicsLayerRoutes.graphics.add(result.route);
    }
    if (data.routeResults.length > 0) {
      this.showDirections(data.routeResults[0].directions.features);
    } else {
      alert("No directions found");
    }
  }

  clearRouter() {
    if (this.view) {
      // Remove all graphics related to routes
      this.removeRoutes();
      this.removePoints();
      console.log("Route cleared");
      this.view.ui.remove(this.directionsElement);
      this.view.ui.empty("top-right");
      console.log("Directions cleared");
    }
  }

  showDirections(features: any[]) {
    this.directionsElement = document.createElement("ol");
    this.directionsElement.classList.add("esri-widget", "esri-widget--panel", "esri-directions__scroller");
    this.directionsElement.style.marginTop = "0";
    this.directionsElement.style.padding = "15px 15px 15px 30px";

    features.forEach((result, i) => {
      const direction = document.createElement("li");
      direction.innerHTML = `${result.attributes.text} (${result.attributes.length} miles)`;
      this.directionsElement.appendChild(direction);
    });

    this.view.ui.empty("top-right");
    this.view.ui.add(this.directionsElement, "top-right");
  }

  setupFirebaseSync() {
    this.firebaseUnsubscribe = this.fb.subscribePoints((data) => {
      if (this.graphicsLayerFirebase) {
        this.graphicsLayerFirebase.removeAll();
      }
      if (!data) return;
      Object.keys(data).forEach((k) => {
        const p: any = data[k];
        if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
        const point = new Point({ longitude: p.lng, latitude: p.lat });
        const symbol = {
          type: 'simple-marker',
          color: [0, 120, 255],
          outline: { color: [255, 255, 255], width: 1 },
          size: 10
        };
        const g = new Graphic({ geometry: point, symbol, attributes: { ...p, id: k } });
        this.graphicsLayerFirebase.add(g);
      });
    });

    this.centerSyncTimer = setInterval(() => {
      if (!this.view || !this.view.center) return;
      const center = this.view.center as any;
      const now = Date.now();
      if (now - this.lastCenterSent < 1000) return;
      this.lastCenterSent = now;
      try {
        this.fb.updateUserPosition(this.clientId, { lat: center.latitude, lng: center.longitude, timestamp: now });
      } catch (err) {
        console.error('Error updating user position to Firebase', err);
      }
    }, 1000);
  }

  ngOnDestroy() {
    if (this.view) {
      this.view.container = null;
    }
    if (this.firebaseUnsubscribe) {
      this.firebaseUnsubscribe();
      this.firebaseUnsubscribe = null;
    }
    if (this.userPosUnsubscribe) {
      this.userPosUnsubscribe();
      this.userPosUnsubscribe = null;
    }
    if (this.centerSyncTimer) {
      clearInterval(this.centerSyncTimer);
      this.centerSyncTimer = null;
    }
  }
}




