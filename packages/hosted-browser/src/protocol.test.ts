import { describe, expect, it } from "vitest";

import { hostedBrowserViewports, viewportProfileForClientWidth, viewportSize } from "./protocol.ts";

describe("hosted browser viewport profiles", () => {
  it("gives a phone-sized client the phone profile and a wide client the desktop profile", () => {
    expect(viewportProfileForClientWidth(390)).toBe("phone");
    expect(viewportProfileForClientWidth(767)).toBe("phone");
    expect(viewportProfileForClientWidth(768)).toBe("desktop");
    expect(viewportProfileForClientWidth(1440)).toBe("desktop");
  });

  it("uses a phone aspect for the phone profile and a desktop aspect for the desktop profile", () => {
    expect(viewportSize("phone")).toEqual({ width: 390, height: 844 });
    expect(viewportSize("desktop")).toEqual({ width: 1100, height: 720 });
    expect(hostedBrowserViewports.phone.width).toBeLessThan(hostedBrowserViewports.desktop.width);
  });
});
