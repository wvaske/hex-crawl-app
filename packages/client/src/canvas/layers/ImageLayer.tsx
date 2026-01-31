import { Assets, Container, Sprite, Texture } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { useImageLayerStore } from '../../stores/useImageLayerStore';

/**
 * PixiJS layer that renders uploaded map images as background sprites.
 *
 * Subscribes to useImageLayerStore and creates a Sprite for each visible layer,
 * sorted by sortOrder. Placed as the first child in the viewport so images
 * render beneath the hex grid and all other layers.
 */
export function ImageLayer() {
  const containerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  const layers = useImageLayerStore((s) => s.layers);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sprites = spritesRef.current;
    const currentIds = new Set<string>();

    // Track which layers we want visible
    for (const layer of layers) {
      if (!layer.visible) continue;
      currentIds.add(layer.id);

      const existing = sprites.get(layer.id);
      if (existing) {
        // Update position/scale of existing sprite
        existing.position.set(layer.offsetX, layer.offsetY);
        existing.scale.set(layer.scaleX, layer.scaleY);
        // Ensure correct z-order by setting zIndex
        existing.zIndex = layer.sortOrder;
      } else if (!loadingRef.current.has(layer.id)) {
        // Load texture and create sprite
        loadingRef.current.add(layer.id);
        const layerSnapshot = { ...layer };

        Assets.load<Texture>(layer.url)
          .then((texture) => {
            loadingRef.current.delete(layerSnapshot.id);

            // Check container still exists and layer still wanted
            const cont = containerRef.current;
            if (!cont) return;

            const sprite = new Sprite(texture);
            sprite.position.set(layerSnapshot.offsetX, layerSnapshot.offsetY);
            sprite.scale.set(layerSnapshot.scaleX, layerSnapshot.scaleY);
            sprite.zIndex = layerSnapshot.sortOrder;

            cont.addChild(sprite);
            spritesRef.current.set(layerSnapshot.id, sprite);
          })
          .catch(() => {
            loadingRef.current.delete(layerSnapshot.id);
          });
      }
    }

    // Remove sprites for layers no longer visible or removed
    sprites.forEach((sprite, id) => {
      if (!currentIds.has(id)) {
        container.removeChild(sprite);
        sprite.destroy();
        sprites.delete(id);
      }
    });

    // Enable sortableChildren so zIndex is respected
    container.sortableChildren = true;
  }, [layers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      spritesRef.current.forEach((sprite) => {
        sprite.destroy();
      });
      spritesRef.current.clear();
    };
  }, []);

  return (
    <pixiContainer
      ref={(ref: Container | null) => {
        containerRef.current = ref;
      }}
    />
  );
}
