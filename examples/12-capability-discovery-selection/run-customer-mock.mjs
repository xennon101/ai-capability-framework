import {
  runCustomerRequestExample,
  runSimpleHybridExample
} from "./customer-request-example.mjs";

console.log(
  JSON.stringify(
    {
      customerFlow: await runCustomerRequestExample(),
      hybrid: await runSimpleHybridExample()
    },
    null,
    2
  )
);
