import { useState, useEffect, useCallback } from "react";

export type FavoriteProperty = {
  id: number;
  title: string;
  price: number;
  type: string;
};

const FAVORITES_KEY = "favorites";
const FAVORITES_EVENT = "favorites-updated";

function getFavoritesFromStorage(): FavoriteProperty[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteProperty[]>(getFavoritesFromStorage);

  useEffect(() => {
    const handler = () => {
      setFavorites(getFavoritesFromStorage());
    };
    window.addEventListener(FAVORITES_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const saveFavorites = useCallback((updated: FavoriteProperty[]) => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    setFavorites(updated);
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  }, []);

  const addToFavorites = useCallback((property: FavoriteProperty) => {
    const current = getFavoritesFromStorage();
    if (!current.some((fav) => fav.id === property.id)) {
      saveFavorites([...current, property]);
    }
  }, [saveFavorites]);

  const removeFromFavorites = useCallback((propertyId: number) => {
    const current = getFavoritesFromStorage();
    saveFavorites(current.filter((fav) => fav.id !== propertyId));
  }, [saveFavorites]);

  const toggleFavorite = useCallback((property: FavoriteProperty) => {
    const current = getFavoritesFromStorage();
    if (current.some((fav) => fav.id === property.id)) {
      saveFavorites(current.filter((fav) => fav.id !== property.id));
    } else {
      saveFavorites([...current, property]);
    }
  }, [saveFavorites]);

  const isFavorite = useCallback((propertyId: number) => {
    return favorites.some((fav) => fav.id === propertyId);
  }, [favorites]);

  return { favorites, addToFavorites, removeFromFavorites, toggleFavorite, isFavorite };
}
