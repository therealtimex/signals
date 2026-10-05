import { describe, expect, it } from "vitest";
import { corporateEmailDomain } from "@/lib/contacts/corporate-domain";

describe("corporateEmailDomain", () => {
  it.each<[string | null | undefined, string | null]>([
    [null, null],
    [undefined, null],
    ["", null],
    ["no-at-sign", null],
    ["bui-sy.giang@mes-engineering.com.vn", "mes-engineering.com.vn"],
    ["Giang@MES-Engineering.com.vn", "mes-engineering.com.vn"],
    ["giang.bui@gmail.com", null],
    ["giang@yahoo.fr", null],
    ["giang@yahoo.com.vn", null],
    ["giang@hotmail.co.uk", null],
    ["giang@outlook.com.vn", null],
    ["giang@qq.com", null],
    ["root@localhost", null],
    ["root@[192.168.1.10]", null],
    ["giang@mail.mes-engineering.com.vn", "mail.mes-engineering.com.vn"],
  ])("%j -> %j", (email, expected) => {
    expect(corporateEmailDomain(email)).toBe(expected);
  });
});
