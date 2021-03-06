/** @typedef {import('@loaders.gl/loader-utils').WorkerLoaderObject} WorkerLoaderObject */
/** @typedef {import('@loaders.gl/loader-utils').LoaderObject} LoaderObject */
import loadTerrain from './lib/parse-terrain';
import {VERSION} from './lib/utils/version';

/**
 * Worker loader for quantized meshes
 * @type {WorkerLoaderObject}
 */
export const TerrainWorkerLoader = {
  name: 'Terrain',
  id: 'terrain',
  module: 'terrain',
  version: VERSION,
  worker: true,
  extensions: ['png', 'pngraw'],
  mimeTypes: ['image/png'],
  options: {
    terrain: {
      tesselator: 'auto',
      bounds: null,
      meshMaxError: 10,
      elevationDecoder: {
        rScaler: 1,
        gScaler: 0,
        bScaler: 0,
        offset: 0
      }
    }
  }
};

/**
 * Loader for quantized meshes
 * @type {LoaderObject}
 */
export const TerrainLoader = {
  ...TerrainWorkerLoader,
  parse: loadTerrain
};
