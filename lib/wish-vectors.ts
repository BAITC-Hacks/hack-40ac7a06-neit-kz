import { embedWish } from './embeddings';
import type { WishVectors } from './scoring';

/** Векторы пожеланий: из кэша репозитория, а при наличии ключа — считаются и докладываются в кэш. */
export async function resolveWishVectors(wishes: string[] | undefined): Promise<WishVectors> {
  if (!wishes?.length) return {};
  const out: WishVectors = {};
  for (const wish of wishes) {
    const vec = await embedWish(wish);
    if (vec) out[wish] = vec;
  }
  return out;
}
