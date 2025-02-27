/**
 * Marker handler
 * @extends {L.CircleMarker}
 */
L.PathTransform.Handle = L.CircleMarker.extend({
  options: {
    className: 'leaflet-path-transform-handler',
  },

  onAdd: function (map) {
    L.CircleMarker.prototype.onAdd.call(this, map);
    if (this._path && this.options.setCursor) {
      // SVG/VML
      this._path.style.cursor =
        L.PathTransform.Handle.CursorsByType[this.options.index];
    }
  },
});

/**
 * @const
 * @type {Array}
 */
L.PathTransform.Handle.CursorsByType = [
  'nesw-resize',
  'nwse-resize',
  'nesw-resize',
  'nwse-resize',
];

/**
 * @extends {L.Handler.PathTransform.Handle}
 */
L.PathTransform.RotateHandle = L.PathTransform.Handle.extend({
  options: {
    className: 'leaflet-path-transform-handler transform-handler--rotate',
  },

  onAdd: function (map) {
    L.CircleMarker.prototype.onAdd.call(this, map);
    if (this._path && this.options.setCursor) {
      // SVG/VML
      this._path.style.cursor = 'all-scroll';
    }
  },
});

L.Handler.PathTransform = L.Handler.extend({
  options: {
    rotation: true,
    rotationAnchor: null,
    scaling: true,
    uniformScaling: true,
    maxZoom: 22,

    // edge handlers
    handlerOptions: {
      radius: 5,
      fillColor: '#ffffff',
      color: '#202020',
      fillOpacity: 1,
      weight: 2,
      opacity: 0.7,
      setCursor: true,
    },

    // rectangle
    boundsOptions: {
      weight: 1,
      opacity: 1,
      dashArray: [3, 3],
      fill: false,
      noClip: true,
    },

    // rotation handler
    rotateHandleOptions: {
      weight: 1,
      opacity: 1,
      setCursor: true,
    },
    // rotation handle length
    handleLength: 20,

    // maybe I'll add skewing in the future
    edgesCount: 4,

    handleClass: L.PathTransform.Handle,
    rotateHandleClass: L.PathTransform.RotateHandle,
  },

  /**
   * @class L.Handler.PathTransform
   * @constructor
   * @param  {L.Path} path
   */
  initialize: function (path) {
    // references
    this._path = path;
    this._map = null;

    // handlers
    this._activeMarker = null;
    this._originMarker = null;
    this._rotationMarker = null;

    // origins & temporary state
    this._rotationOrigin = null;
    this._scaleOrigin = null;
    this._angle = 0;
    this._scale = L.point(1, 1);
    this._initialDist = 0;
    this._initialDistX = 0;
    this._initialDistY = 0;
    this._rotationStart = null;
    this._rotationOriginPt = null;

    // preview and transform matrix
    this._matrix = new L.Matrix(1, 0, 0, 1, 0, 0);
    this._projectedMatrix = new L.Matrix(1, 0, 0, 1, 0, 0);

    // ui elements
    this._handlersGroup = null;
    this._rect = null;
    this._handlers = [];
    this._handleLine = null;
  },

  /**
   * If the polygon is not rendered, you can transform it yourself
   * in the coordinates, and do it properly.
   * @param {Object=} options
   */
  enable: function (options) {
    if (this._path._map) {
      this._map = this._path._map;
      if (options) {
        this.setOptions(options);
      }
      L.Handler.prototype.enable.call(this);
    }
  },

  /**
   * Init interactions and handlers
   */
  addHooks: function () {
    this._createHandlers();
    this._path
      .on('dragstart', this._onDragStart, this)
      .on('dragend', this._onDragEnd, this);
  },

  /**
   * Remove handlers
   */
  removeHooks: function () {
    this._hideHandlers();
    this._path
      .off('dragstart', this._onDragStart, this)
      .off('dragend', this._onDragEnd, this);
    this._handlersGroup = null;
    this._rect = null;
    this._handlers = [];
  },

  /**
   * Change editing options
   * @param {Object} options
   */
  setOptions: function (options) {
    var enabled = this._enabled;
    if (enabled) {
      this.disable();
    }

    this.options = L.PathTransform.merge(
      {},
      L.Handler.PathTransform.prototype.options,
      options
    );

    if (enabled) {
      this.enable();
    }

    return this;
  },

  /**
   * @param  {Number}   angle
   * @param  {L.LatLng} origin
   * @return {L.Handler.PathTransform}
   */
  rotate: function (angle, origin) {
    return this.transform(angle, null, origin);
  },

  /**
   * @param  {L.Point|Number} scale
   * @param  {L.LatLng}       origin
   * @return {L.Handler.PathTransform}
   */
  scale: function (scale, origin) {
    if (typeof scale === 'number') {
      scale = L.point(scale, scale);
    }
    return this.transform(0, scale, null, origin);
  },

  /**
   * @param  {Number}    angle
   * @param  {L.Point}   scale
   * @param  {L.LatLng=} rotationOrigin
   * @param  {L.LatLng=} scaleOrigin
   * @return {L.Handler.PathTransform}
   */
  transform: function (angle, scale, rotationOrigin, scaleOrigin) {
    var center = this._path.getCenter();
    rotationOrigin = rotationOrigin || center;
    scaleOrigin = scaleOrigin || center;
    this._map = this._path._map;
    this._transformPoints(
      this._path,
      angle,
      scale,
      rotationOrigin,
      scaleOrigin
    );
    this._transformPoints(
      this._rect,
      angle,
      scale,
      rotationOrigin,
      scaleOrigin
    );
    this._transformPoints(
      this._handleLine,
      angle,
      scale,
      rotationOrigin,
      scaleOrigin
    );
    this._updateHandlers();
    return this;
  },

  /**
   * Update the polygon and handlers preview, no reprojection
   */
  _update: function () {
    var matrix = this._matrix;

    // update handlers
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      if (handler !== this._originMarker) {
        handler._point = matrix.transform(handler._initialPoint);
        handler._updatePath();
      }
    }

    matrix = matrix.clone().flip();

    this._applyTransform(matrix);
    this._path.fire('transform', { layer: this._path });
  },

  /**
   * @param  {L.Matrix} matrix
   */
  _applyTransform: function (matrix) {
    this._path._transform(matrix._matrix);
    this._rect._transform(matrix._matrix);

    if (this.options.rotation) {
      this._handleLine._transform(matrix._matrix);
    }
  },

  /**
   * Apply final transformation
   */
  _apply: function () {
    //console.group('apply transform');
    var map = this._map;
    var matrix = this._matrix.clone();
    var angle = this._angle;
    var scale = this._scale.clone();

    this._transformGeometries();

    // update handlers
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      handler._latlng = map.layerPointToLatLng(handler._point);
      delete handler._initialPoint;
      handler.redraw();
    }

    this._matrix = L.matrix(1, 0, 0, 1, 0, 0);
    this._scale = L.point(1, 1);
    this._angle = 0;

    this._updateHandlers();

    map.dragging.enable();
    this._path.fire('transformed', {
      matrix: matrix,
      scale: scale,
      rotation: angle,
      // angle: angle * (180 / Math.PI),
      layer: this._path,
    });
    // console.groupEnd('apply transform');
  },

  /**
   * Use this method to completely reset handlers, if you have changed the
   * geometry of transformed layer
   */
  reset: function () {
    if (this._enabled) {
      if (this._rect) {
        this._handlersGroup.removeLayer(this._rect);
        this._rect = this._getBoundingPolygon().addTo(this._handlersGroup);
      }
      this._updateHandlers();
    }
  },

  /**
   * Recalculate rotation handlers position
   */
  _updateHandlers: function () {
    var handlersGroup = this._handlersGroup;

    this._rectShape = this._rect.toGeoJSON();

    if (this._handleLine) {
      this._handlersGroup.removeLayer(this._handleLine);
    }

    if (this._rotationMarker) {
      this._handlersGroup.removeLayer(this._rotationMarker);
    }

    this._handleLine = this._rotationMarker = null;

    for (var i = this._handlers.length - 1; i >= 0; i--) {
      handlersGroup.removeLayer(this._handlers[i]);
    }

    this._createHandlers();
  },

  /**
   * Transform geometries separately
   */
  _transformGeometries: function () {
    this._path._transform(null);
    this._rect._transform(null);

    if (this.options.rotation) {
      this._handleLine._transform(null);
      this._transformPoints(this._path, this._angle, null, this.options.rotationAnchor);
      this._transformPoints(this._rect, this._angle, null, this.options.rotationAnchor);
      this._transformPoints(this._handleLine, this._angle, null, this.options.rotationAnchor);
    } else {
      this._transformPoints(this._path);
      this._transformPoints(this._rect);
    }
  },

  /**
   * @param {Number} angle
   * @param {Number} scale
   * @param {L.LatLng=} rotationOrigin
   * @param {L.LatLng=} scaleOrigin
   */
  _getProjectedMatrix: function (angle, scale, rotationOrigin, scaleOrigin) {
    var map = this._map;
    var zoom = map.getMaxZoom() || this.options.maxZoom;
    var matrix = L.matrix(1, 0, 0, 1, 0, 0);
    var origin;

    angle = angle || this._angle || 0;
    scale = scale || this._scale || L.point(1, 1);

    if (!(scale.x === 1 && scale.y === 1)) {
      scaleOrigin = scaleOrigin || this._scaleOrigin;
      origin = map.project(scaleOrigin, zoom);
      matrix = matrix
        ._add(L.matrix(1, 0, 0, 1, origin.x, origin.y))
        ._add(L.matrix(scale.x, 0, 0, scale.y, 0, 0))
        ._add(L.matrix(1, 0, 0, 1, -origin.x, -origin.y));
    }

    if (angle) {
      rotationOrigin = rotationOrigin || this._rotationOrigin;
      origin = map.project(rotationOrigin, zoom);
      matrix = matrix.rotate(angle, origin).flip();
    }

    return matrix;
  },

  /**
   * @param  {L.LatLng} latlng
   * @param  {L.Matrix} matrix
   * @param  {L.Map}    map
   * @param  {Number}   zoom
   * @return {L.LatLng}
   */
  _transformPoint: function (latlng, matrix, map, zoom) {
    return map.unproject(matrix.transform(map.project(latlng, zoom)), zoom);
  },

  /**
   * Applies transformation, does it in one sweep for performance,
   * so don't be surprised about the code repetition.
   *
   * @param {L.Path}    path
   * @param {Number=}   angle
   * @param {L.Point=}  scale
   * @param {L.LatLng=} rotationOrigin
   * @param {L.LatLng=} scaleOrigin
   */
  _transformPoints: function (path, angle, scale, rotationOrigin, scaleOrigin) {
    var map = path._map;
    var zoom = map.getMaxZoom() || this.options.maxZoom;
    var i, len;

    var projectedMatrix = (this._projectedMatrix = this._getProjectedMatrix(
      angle,
      scale,
      rotationOrigin,
      scaleOrigin
    ));
    // console.time('transform');

    // all shifts are in-place
    if (path._point) {
      // L.Circle
      path._latlng = this._transformPoint(
        path._latlng,
        projectedMatrix,
        map,
        zoom
      );
      var box = this._getBoundingPolygon();
      var radius = Math.floor(
        Math.abs(box._bounds._southWest.lat - box._bounds._northEast.lat) / 2
      );
      path.setRadius(radius);
    } else if (path._rings || path._parts) {
      // everything else
      var rings = path._rings;
      var latlngs = path._latlngs;
      path._bounds = new L.LatLngBounds();

      if (!L.Util.isArray(latlngs[0])) {
        // polyline
        latlngs = [latlngs];
      }
      for (i = 0, len = rings.length; i < len; i++) {
        for (var j = 0, jj = rings[i].length; j < jj; j++) {
          latlngs[i][j] = this._transformPoint(
            latlngs[i][j],
            projectedMatrix,
            map,
            zoom
          );
          path._bounds.extend(latlngs[i][j]);
        }
      }
    }

    path._reset();
    //console.timeEnd('transform');
  },

  /**
   * Creates markers and handles
   */
  _createHandlers: function () {
    var map = this._map;
    this._handlersGroup = this._handlersGroup || new L.LayerGroup().addTo(map);
    this._rect =
      this._rect || this._getBoundingPolygon().addTo(this._handlersGroup);

    if (this.options.scaling) {
      this._handlers = [];
      for (var i = 0; i < this.options.edgesCount; i++) {
        // TODO: add stretching
        this._handlers.push(
          this._createHandler(this._rect._latlngs[0][i], i * 2, i).addTo(
            this._handlersGroup
          )
        );
      }
    }

    // add bounds
    if (this.options.rotation) {
      //add rotation handler
      this._createRotationHandlers();
    }

    // move handlers to the top of all other layers; prevents handlers from
    // being blocked by other layers
    this._handlersGroup.getLayers().forEach(function(layer) { layer.bringToFront(); });
  },

  /**
   * Rotation marker and small connectin handle
   */
  _createRotationHandlers: function () {
    var map = this._map;
    var latlngs = this._rect._latlngs[0];

    var bottom = new L.LatLng(
      (latlngs[0].lat + latlngs[3].lat) / 2,
      (latlngs[0].lng + latlngs[3].lng) / 2
    );
    // hehe, top is a reserved word
    var topPoint = new L.LatLng(
      (latlngs[1].lat + latlngs[2].lat) / 2,
      (latlngs[1].lng + latlngs[2].lng) / 2
    );

    var handlerPosition = map.layerPointToLatLng(
      L.PathTransform.pointOnLine(
        map.latLngToLayerPoint(bottom),
        map.latLngToLayerPoint(topPoint),
        this.options.handleLength
      )
    );

    this._handleLine = new L.Polyline(
      [topPoint, handlerPosition],
      this.options.rotateHandleOptions
    ).addTo(this._handlersGroup);
    var RotateHandleClass = this.options.rotateHandleClass;
    this._rotationMarker = new RotateHandleClass(
      this.options.rotateHandleOptions.handlerOrigin || handlerPosition,
      this.options.handlerOptions
    )
      .addTo(this._handlersGroup)
      .on('mousedown', this._onRotateStart, this);

    this._rotationOrigin = new L.LatLng(
      (topPoint.lat + bottom.lat) / 2,
      (topPoint.lng + bottom.lng) / 2
    );

    this._handlers.push(this._rotationMarker);
  },

  /**
   * @return {L.LatLng}
   */
  _getRotationOrigin: function () {
    if (this.options.rotationAnchor) {
      var anchor = this.options.rotationAnchor;
      if (anchor.constructor === Array && anchor.length >= 2) {
        return new L.LatLng(anchor[0], anchor[1]);
      } else if (anchor instanceof L.LatLng) {
        return anchor;
      }
    }

    var latlngs = this._rect._latlngs[0];
    var lb = latlngs[0];
    var rt = latlngs[2];

    return new L.LatLng((lb.lat + rt.lat) / 2, (lb.lng + rt.lng) / 2);
  },

  /**
   * Secure the rotation origin
   * @param  {Event} evt
   */
  _onRotateStart: function (evt) {
    var map = this._map;

    map.dragging.disable();

    this._originMarker = null;
    this._rotationOriginPt = map.latLngToLayerPoint(this._getRotationOrigin());
    this._rotationStart = evt.layerPoint;
    this._initialMatrix = this._matrix.clone();

    this._angle = 0;
    this._path._map
      .on('mousemove', this._onRotate, this)
      .on('mouseup', this._onRotateEnd, this);

    this._cachePoints();
    this._path
      .fire('transformstart', { layer: this._path })
      .fire('rotatestart', { layer: this._path, rotation: 0 });
  },

  /**
   * @param  {Event} evt
   */
  _onRotate: function (evt) {
    var pos = evt.layerPoint;
    var previous = this._rotationStart;
    var origin = this._rotationOriginPt;

    // rotation step angle
    this._angle =
      Math.atan2(pos.y - origin.y, pos.x - origin.x) -
      Math.atan2(previous.y - origin.y, previous.x - origin.x);

    this._matrix = this._initialMatrix
      .clone()
      .rotate(this._angle, origin)
      .flip();

    this._update();
    this._path.fire('rotate', { layer: this._path, rotation: this._angle });
  },

  /**
   * @param  {Event} evt
   */
  _onRotateEnd: function (evt) {
    this._path._map
      .off('mousemove', this._onRotate, this)
      .off('mouseup', this._onRotateEnd, this);

    var angle = this._angle;
    this._apply();
    this._path.fire('rotateend', { layer: this._path, rotation: angle, options: evt });
  },

  /**
   * @param  {Event} evt
   */
  _onScaleStart: function (evt) {
    var marker = evt.target;
    var map = this._map;

    map.dragging.disable();

    this._activeMarker = marker;

    this._originMarker = this._handlers[(marker.options.index + 2) % 4];
    this._scaleOrigin = this._originMarker.getLatLng();

    this._initialMatrix = this._matrix.clone();
    this._cachePoints();

    this._map
      .on('mousemove', this._onScale, this)
      .on('mouseup', this._onScaleEnd, this);
    this._initialDist = this._originMarker._point.distanceTo(
      this._activeMarker._point
    );
    this._initialDistX =
      this._originMarker._point.x - this._activeMarker._point.x;
    this._initialDistY =
      this._originMarker._point.y - this._activeMarker._point.y;

    this._path
      .fire('transformstart', { layer: this._path })
      .fire('scalestart', { layer: this._path, scale: L.point(1, 1) });

    if (this._handleLine) {
      this._map.removeLayer(this._handleLine);
    }
    if (this._rotationMarker) {
      this._map.removeLayer(this._rotationMarker);
    }

    //this._handleLine = this._rotationMarker = null;
  },

  /**
   * @param  {Event} evt
   */
  _onScale: function (evt) {
    var originPoint = this._originMarker._point;
    var ratioX, ratioY;
    if (this.options.uniformScaling) {
      ratioX = originPoint.distanceTo(evt.layerPoint) / this._initialDist;
      ratioY = ratioX;
    } else {
      ratioX = (originPoint.x - evt.layerPoint.x) / this._initialDistX;
      ratioY = (originPoint.y - evt.layerPoint.y) / this._initialDistY;
    }

    this._scale = new L.Point(ratioX, ratioY);

    // update matrix
    this._matrix = this._initialMatrix.clone().scale(this._scale, originPoint);

    this._update();
    this._path.fire('scale', {
      layer: this._path,
      scale: this._scale.clone(),
    });
  },

  /**
   * Scaling complete
   * @param  {Event} evt
   */
  _onScaleEnd: function (evt) {
    this._map
      .off('mousemove', this._onScale, this)
      .off('mouseup', this._onScaleEnd, this);

    if (this._handleLine) {
      this._map.addLayer(this._handleLine);
    }
    if (this._rotationMarker) {
      this._map.addLayer(this._rotationMarker);
    }

    this._apply();
    this._path.fire('scaleend', {
      layer: this._path,
      scale: this._scale.clone(),
    });
  },

  /**
   * Cache current handlers positions
   */
  _cachePoints: function () {
    this._handlersGroup.eachLayer(function (layer) {
      layer.bringToFront();
    });
    for (var i = 0, len = this._handlers.length; i < len; i++) {
      var handler = this._handlers[i];
      handler._initialPoint = handler._point.clone();
    }
  },

  /**
   * Bounding polygon
   * @return {L.Polygon}
   */
  _getBoundingPolygon: function () {
    if (this._rectShape) {
      return L.GeoJSON.geometryToLayer(
        this._rectShape,
        this.options.boundsOptions
      );
    } else {
      return new L.Rectangle(
        this._path.getBounds(),
        this.options.boundsOptions
      );
    }
  },

  /**
   * Create corner marker
   * @param  {L.LatLng} latlng
   * @param  {Number}   type one of L.Handler.PathTransform.HandlerTypes
   * @param  {Number}   index
   * @return {L.Handler.PathTransform.Handle}
   */
  _createHandler: function (latlng, type, index) {
    var HandleClass = this.options.handleClass;
    var marker = new HandleClass(
      latlng,
      L.Util.extend({}, this.options.handlerOptions, {
        className:
          'leaflet-drag-transform-marker drag-marker--' +
          index +
          ' drag-marker--' +
          type,
        index: index,
        type: type,
      })
    );

    marker.on('mousedown', this._onScaleStart, this);
    return marker;
  },

  /**
   * Hide(not remove) the handlers layer
   */
  _hideHandlers: function () {
    this._map.removeLayer(this._handlersGroup);
  },

  /**
   * Hide handlers and rectangle
   */
  _onDragStart: function () {
    this._hideHandlers();
  },

  /**
   * Drag rectangle, re-create handlers
   */
  _onDragEnd: function (evt) {
    var rect = this._rect;
    var matrix = (evt.layer ? evt.layer : this._path).dragging._matrix.slice();

    if (!rect.dragging) {
      rect.dragging = new L.Handler.PathDrag(rect);
    }
    rect.dragging.enable();
    this._map.addLayer(rect);
    rect.dragging._transformPoints(matrix);
    rect._updatePath();
    rect._project();
    rect.dragging.disable();

    this._map.addLayer(this._handlersGroup);
    this._updateHandlers();

    this._path.fire('transformed', {
      scale: L.point(1, 1),
      rotation: 0,
      matrix: L.matrix.apply(undefined, matrix),
      translate: L.point(matrix[4], matrix[5]),
      layer: this._path,
    });
  },
});

L.Path.addInitHook(function () {
  if (this.options.transform) {
    this.transform = new L.Handler.PathTransform(this, this.options.transform);
  }
});
