const test = require("node:test");
const assert = require("node:assert/strict");
const { meteredMilestoneKey } = require("../../refresh_sales_leader_data");

const milestone = (id, name, extra = {}) => ({
  Id: id,
  Name: name,
  CreatedById: "ebr",
  CreatedDate: "2026-10-29T16:29:16Z",
  Opportunity__c: "006-opportunity",
  Opportunity_Product__c: "a4p-product",
  Product__c: "01t-product",
  Total_Expected_Change__c: 416.67,
  ...extra
});

test("exact duplicate metered milestones share a key", () => {
  assert.equal(
    meteredMilestoneKey(milestone("one", "Customer Copilot Tokens January 2027")),
    meteredMilestoneKey(milestone("two", "Customer Copilot Tokens January 2027"))
  );
});

test("distinct milestone months and products remain additive", () => {
  const january = meteredMilestoneKey(milestone("one", "Customer Copilot Tokens January 2027"));
  const february = meteredMilestoneKey(milestone("two", "Customer Copilot Tokens February 2027"));
  const otherProduct = meteredMilestoneKey(milestone("three", "Customer GHAS January 2027", {
    Opportunity_Product__c: "a4p-ghas",
    Product__c: "01t-ghas"
  }));
  assert.notEqual(january, february);
  assert.notEqual(january, otherProduct);
});
