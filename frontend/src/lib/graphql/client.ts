import { GraphQLClient, gql } from 'graphql-request';

const endpoint = import.meta.env.VITE_GRAPHQL_URL || 'http://localhost:4000/api/graphql';

export const client = new GraphQLClient(endpoint, {
  headers: {
    'content-type': 'application/json'
  }
});

export const Queries = {
  CampaignSummaries: gql`
    query CampaignSummaries {
      campaigns {
        id
        name
        description
        default_hex_size
        maps {
          id
          name
          hex_size_px
          scale_ratio
          tileset_path
          explored_hexes {
            q
            r
          }
          current_player_hex {
            q
            r
          }
        }
        share_links {
          id
          token
          expires_at
        }
      }
    }
  `,
  CampaignDetail: gql`
    query CampaignDetail($id: ID!) {
      campaign(id: $id) {
        id
        name
        description
        default_hex_size
        maps {
          id
          name
          hex_size_px
          scale_ratio
          tileset_path
          explored_hexes {
            q
            r
          }
          current_player_hex {
            q
            r
          }
        }
        share_links {
          id
          token
          label
          expires_at
        }
      }
    }
  `,
  MapDetail: gql`
    query MapDetail($id: ID!) {
      map(id: $id) {
        id
        name
        tileset_path
        bounds {
          min_q
          max_q
          min_r
          max_r
        }
        explored_hexes {
          q
          r
        }
        current_player_hex {
          q
          r
        }
        items {
          id
          name
          description
          icon
          visibility_distance
          always_visible
          hex_id
        }
        campaign {
          id
          name
        }
      }
    }
  `,
  ExplorationHistory: gql`
    query History($mapId: ID!, $limit: Int) {
      explorationHistory(mapId: $mapId, limit: $limit) {
        id
        type
        occurred_at
        payload
      }
    }
  `
};

export const Mutations = {
  SetPlayerLocation: gql`
    mutation SetPlayerLocation($mapId: ID!, $q: Int!, $r: Int!) {
      setPlayerLocation(mapId: $mapId, q: $q, r: $r) {
        id
        current_player_hex {
          q
          r
        }
        explored_hexes {
          q
          r
        }
      }
    }
  `,
  RevealHexes: gql`
    mutation RevealHexes($mapId: ID!, $hexes: [HexCoordsInput!]!) {
      revealHexes(mapId: $mapId, hexes: $hexes) {
        id
        explored_hexes {
          q
          r
        }
      }
    }
  `,
  CreateHexItem: gql`
    mutation CreateHexItem($mapId: ID!, $hex: HexCoordsInput!, $name: String!, $description: String, $visibility_distance: Int, $always_visible: Boolean) {
      createHexItem(mapId: $mapId, hex: $hex, name: $name, description: $description, visibility_distance: $visibility_distance, always_visible: $always_visible) {
        id
        name
        description
        visibility_distance
        always_visible
        hex_id
      }
    }
  `
};
