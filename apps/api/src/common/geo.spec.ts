import { haversineKm, homeTravel } from "./geo";

describe("invoice travel", () => {
  const capeTown = { lat: -33.9249, lng: 18.4241 };
  const stellenbosch = { lat: -33.9321, lng: 18.8602 };
  const home = { homeLat: capeTown.lat, homeLng: capeTown.lng, travelRatePerKm: 4.95 };

  it("measures the straight-line distance between two points", () => {
    expect(haversineKm(capeTown, stellenbosch)).toBeGreaterThan(40);
    expect(haversineKm(capeTown, capeTown)).toBe(0);
  });

  it("bills the return trip from home to the venue at the platform rate", () => {
    const oneWay = haversineKm(capeTown, stellenbosch);
    const travel = homeTravel(home, stellenbosch);

    expect(travel).not.toBeNull();
    expect(travel!.distanceKm).toBeCloseTo(oneWay * 2, 1);
    expect(travel!.fee).toBe(Math.round(travel!.distanceKm * 4.95));
  });

  it("returns null instead of inventing travel without a home base or venue fix", () => {
    expect(homeTravel({ homeLat: null, homeLng: null, travelRatePerKm: 4.95 }, capeTown)).toBeNull();
    expect(homeTravel(home, null)).toBeNull();
    expect(homeTravel(home, { lat: null, lng: null })).toBeNull();
  });
});
