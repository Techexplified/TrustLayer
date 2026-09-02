declare module "*.css";

import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": any;
      "s-link": any;
      [elemName: string]: any;
    }
  }
}
