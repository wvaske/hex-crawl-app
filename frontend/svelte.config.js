import adapter from '@sveltejs/adapter-node';
import preprocess from 'svelte-preprocess';

const config = {
  preprocess: preprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $components: 'src/lib/components',
      $graphql: 'src/lib/graphql',
      $realtime: 'src/lib/realtime',
      $stores: 'src/lib/stores'
    }
  }
};

export default config;
