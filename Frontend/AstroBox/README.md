# AstroBox

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.7.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Climate Zones layer

The Climate Zones layer uses the Köppen-Geiger classification from Beck et al.
(2023), based on long-term climate normals for 1991–2020. The source product is
the global 1 km dataset distributed by [GloH2O](https://www.gloh2o.org/koppen/)
and [Figshare](https://doi.org/10.6084/m9.figshare.21789074); the map requests
the 2005 midpoint slice for the 1991–2020 period from Esri's public global
[ImageServer](https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Koppen_Geiger_Climate_Classification/ImageServer).
The dataset is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution: Beck et al. (2023), *Scientific Data*, 10, 724,
[doi:10.1038/s41597-023-02549-6](https://doi.org/10.1038/s41597-023-02549-6).

The map uses the source's LERC raster tiles and class values, not boundaries
estimated from current weather. The `lerc` package (Apache-2.0) decodes these
tiles in the browser. The service currently exposes levels through 0.0083333°
pixels; data gaps remain unclassified and transparent. Selecting a valid land
pixel displays its actual class code and description.

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
