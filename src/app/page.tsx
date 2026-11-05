import ShopApp from "@/components/shop/ShopApp";

/**
 * Витрина: один клиентский экран с навигацией в состоянии.
 * Так переходы мгновенные, а корзина и избранное не перезагружаются при смене экрана.
 */
export default function Home() {
  return <ShopApp />;
}
