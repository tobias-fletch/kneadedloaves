export function orderingAvailability(windowOpen: boolean, checkoutReady: boolean) {
  return {
    orderingOpen: windowOpen && checkoutReady,
    unavailable: windowOpen && !checkoutReady
  };
}
