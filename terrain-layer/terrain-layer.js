// Copyright (c) 2015 - 2017 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import {CompositeLayer, COORDINATE_SYSTEM, WebMercatorViewport} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {load} from '@loaders.gl/core';
import {TerrainLoader} from '../terrain-loader/src/index';
import TileLayer from '../tile-layer/tile-layer';
import {getURLFromTemplate, urlType} from '../tile-layer/utils';
// import SnapFeatures from '@kylebarron/snap-to-tin';

const DUMMY_DATA = [1];

const defaultProps = {
  ...TileLayer.defaultProps,
  // Image url that encodes height data
  elevationData: urlType,
  // Image url to use as texture
  texture: urlType,
  // Martini error tolerance in meters, smaller number -> more detailed mesh
  meshMaxError: {type: 'number', value: 4.0},
  // Bounding box of the terrain image, [minX, minY, maxX, maxY] in world coordinates
  bounds: {
    type: 'array',
    value: null,
    optional: true,
    compare: true
  },
  // Color to use if texture is unavailable
  color: {type: 'color', value: [255, 255, 255]},
  // Object to decode height data, from (r, g, b) to height in meters
  elevationDecoder: {
    type: 'object',
    value: {
      rScaler: 1,
      gScaler: 0,
      bScaler: 0,
      offset: 0
    }
  },
  // Supply url to local terrain worker bundle. Only required if running offline and cannot access CDN.
  workerUrl: {type: 'string', value: null},
  // Same as SimpleMeshLayer wireframe
  wireframe: false,
  material: true,
  tesselator: 'auto',
  loaders: [TerrainLoader]
};

// Turns array of templates into a single string to work around shallow change
function urlTemplateToUpdateTrigger(template) {
  if (Array.isArray(template)) {
    return template.join(';');
  }
  return template;
}

/**
 * state: {
 *   isTiled: True renders TileLayer of many SimpleMeshLayers, false renders one SimpleMeshLayer
 *   terrain: Mesh object. Only defined when isTiled is false.
 * }
 */
export default class TerrainLayer extends CompositeLayer {
  async updateState({props, oldProps}) {
    const elevationDataChanged = props.elevationData !== oldProps.elevationData;
    if (elevationDataChanged) {
      // const { elevationData } = props;
      // const isTiled =
      //   elevationData &&
      //   (Array.isArray(elevationData) ||
      //     (elevationData.includes('{x}') && elevationData.includes('{y}')));
      const isTiled = false; // * hard code to false
      this.setState({isTiled});
    }

    // * Reloading for single terrain mesh
    const shouldReload =
      elevationDataChanged ||
      props.meshMaxError !== oldProps.meshMaxError ||
      // props.elevationDecoder !== oldProps.elevationDecoder ||
      props.bounds !== oldProps.bounds ||
      props.tesselator !== oldProps.tesselator;

    if (!this.state.isTiled && shouldReload && typeof props.elevationData == 'string') {
      const bbox = await Promise.resolve(props.bounds).then((res) => {
        return res;
      });
      props = {...props, bounds: bbox};

      const terrain = this.loadTerrain(props);

      this.setState({terrain});
    }
  }

  async loadTerrain({
    elevationData,
    bounds,
    elevationDecoder,
    meshMaxError,
    workerUrl,
    tesselator
  }) {
    if (!elevationData) {
      return null;
    }
    const options = {
      terrain: {
        bounds,
        meshMaxError,
        elevationDecoder,
        tesselator
      }
    };
    if (workerUrl) {
      options.terrain.workerUrl = workerUrl;
    }
    const terrain = await load(elevationData, this.props.loaders, options);

    // ! test snap-to-tin
    // const snap = new SnapFeatures({
    //   // triples of position indices that make up the faces of the terrain
    //   indices: terrain.indices.value,
    //   // x, y, z positions in space of each index
    //   positions: terrain.attributes.POSITION.value,
    //   // Optional bounding box to clip features to
    //   bounds: [0, 0, 1, 1]
    // });
    // console.log(snap);
    // ! end test

    return terrain;
  }

  getTiledTerrainData(tile) {
    const {elevationData, texture, elevationDecoder, meshMaxError, workerUrl} = this.props;
    const dataUrl = getURLFromTemplate(elevationData, tile);
    const textureUrl = getURLFromTemplate(texture, tile);

    const {bbox, z} = tile;
    const viewport = new WebMercatorViewport({
      longitude: (bbox.west + bbox.east) / 2,
      latitude: (bbox.north + bbox.south) / 2,
      zoom: z
    });
    const bottomLeft = viewport.projectFlat([bbox.west, bbox.south]);
    const topRight = viewport.projectFlat([bbox.east, bbox.north]);
    const bounds = [bottomLeft[0], bottomLeft[1], topRight[0], topRight[1]];

    const terrain = this.loadTerrain({
      elevationData: dataUrl,
      bounds,
      elevationDecoder,
      meshMaxError,
      workerUrl
    });

    const surface = textureUrl
      ? // If surface image fails to load, the tile should still be displayed
        load(textureUrl).catch(() => null)
      : Promise.resolve(null);

    return Promise.all([terrain, surface]);
  }

  renderSubLayers(props) {
    const SubLayerClass = this.getSubLayerClass('mesh', SimpleMeshLayer);
    const {data, color} = props;

    if (!data) {
      return null;
    }

    const [mesh, texture] = data;

    return new SubLayerClass(props, {
      data: DUMMY_DATA,
      mesh,
      texture,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: [0, 0, 0],
      getColor: color
    });
  }

  // Update zRange of viewport
  onViewportLoad(tiles) {
    if (!tiles) {
      return;
    }

    const {zRange} = this.state;
    const ranges = tiles
      .map((tile) => tile.content)
      .filter(Boolean)
      .map((arr) => {
        const bounds = arr[0].header.boundingBox;
        return bounds.map((bound) => bound[2]);
      });
    if (ranges.length === 0) {
      return;
    }
    const minZ = Math.min(...ranges.map((x) => x[0]));
    const maxZ = Math.max(...ranges.map((x) => x[1]));

    if (!zRange || minZ < zRange[0] || maxZ > zRange[1]) {
      this.setState({zRange: [minZ, maxZ]});
    }
  }

  renderLayers() {
    const {
      color,
      material,
      elevationData,
      texture,
      wireframe,
      meshMaxError,
      elevationDecoder,
      tileSize,
      maxZoom,
      minZoom,
      extent,
      maxRequests,
      onTileLoad,
      onTileUnload,
      onTileError,
      maxCacheSize,
      maxCacheByteSize,
      refinementStrategy,
      fetch
    } = this.props;

    if (this.state.isTiled) {
      return new TileLayer(
        this.getSubLayerProps({
          id: 'tiles'
        }),
        {
          wireframe,
          color,
          material,
          getTileData: this.getTiledTerrainData.bind(this),
          renderSubLayers: this.renderSubLayers.bind(this),
          updateTriggers: {
            getTileData: {
              elevationData: urlTemplateToUpdateTrigger(elevationData),
              texture: urlTemplateToUpdateTrigger(texture),
              meshMaxError,
              elevationDecoder
            }
          },
          onViewportLoad: this.onViewportLoad.bind(this),
          zRange: this.state.zRange || null,
          tileSize,
          maxZoom,
          minZoom,
          extent,
          maxRequests,
          onTileLoad,
          onTileUnload,
          onTileError,
          maxCacheSize,
          maxCacheByteSize,
          refinementStrategy,
          fetch
        }
      );
    }

    const SubLayerClass = this.getSubLayerClass('mesh', SimpleMeshLayer);
    return new SubLayerClass(
      this.getSubLayerProps({
        id: 'mesh'
      }),
      {
        data: DUMMY_DATA,
        mesh: this.state.terrain,
        texture,
        _instanced: false,
        getPosition: [0, 0, 0],
        getColor: color,
        material,
        wireframe
      }
    );
  }
}

TerrainLayer.layerName = 'TerrainLayer';
TerrainLayer.defaultProps = defaultProps;
