/// <reference types="@types/webgl2" />

import { CameraFactory } from './camera';
import { Layer } from './layer';

import { MapStyle } from './map-style';

import { KeyEventsFactory } from './key-events';
import { MouseEventsFactory } from './mouse-events';

import { DataApi } from './data-api';
import { LayerManager } from './layer-manager';

import { ICameraData, ILayerData, IGrammar } from './interfaces';

import { LevelType } from './constants';

import { ShaderPicking } from "./shader-picking";
import { ShaderPickingTriangles } from "./shader-picking-triangles";

import { GrammarManager } from "./grammar-manager";
import { KnotManager } from './knot-manager';
import { Knot } from './knot';

class MapView {
    // Html div that will host the map
    protected _mapDiv: HTMLElement;
    // Html canvas used to draw the map
    protected _canvas: HTMLCanvasElement;
    // WebGL context of the canvas
    public _glContext: WebGL2RenderingContext;

    // Layer manager object
    protected _layerManager: LayerManager;
    protected _knotManager: KnotManager;

    // Manages the view configuration loaded (including plots and its interactions)
    protected _grammarManager: GrammarManager;

    protected _grammarInterpreter: any;

    protected _updateStatusCallback: any;

    // interaction variables
    private _camera: any;
    // mouse events
    private _mouse: any;
    // keyboard events
    private _keyboard: any;

    private _knotVisibilityMonitor: any;

    // private _mapViewData: IGrammar;

    protected _embeddedKnots: Set<string>;
    protected _linkedKnots: Set<string>;

    public _viewId: number; // the view to which this map belongs

    resetMap(mapDiv: HTMLElement, grammarInterpreter: any): void {

        this._grammarInterpreter = grammarInterpreter;

    }

    get mouse(): any{
        return this._mouse;
    }

    /**
     * gets the map div
     */
    get div(): HTMLElement {
        return this._mapDiv;
    }

    /**
     * gets the canvas element
     */
    get canvas(): HTMLCanvasElement {
        return this._canvas;
    }

    /**
     * gets the opengl context
     */
    get glContext(): WebGL2RenderingContext {
        return this._glContext;
    }

    /**
     * gets the camera object
     */
    get camera(): any {
        return this._camera;
    }

    /**
     * gets the layers
     */
    get layerManager(): LayerManager {
        return this._layerManager;
    }

    get knotManager(): KnotManager{
        return this._knotManager;
    }

    get grammarManager(): GrammarManager{
        return this._grammarManager;
    }

    /**
     * Map initialization function
     */
    async init(mapDivId: string, updateStatusCallback: any): Promise<void> {

        let mapDiv: any = <HTMLElement>document.getElementById(mapDivId)

        if(mapDiv == null){
            return;
        }

        mapDiv.innerHTML = "";

        this._mapDiv = mapDiv;
        this._canvas = document.createElement('canvas');
        this._canvas.id = mapDiv.id+"_mapCanvas";
        this._canvas.className = "mapView";
        this._glContext = <WebGL2RenderingContext>this._canvas.getContext('webgl2', {preserveDrawingBuffer: true, stencil: true}); // preserve drawing buffer is used to generate valid blobs for the cave
        this._mapDiv.appendChild(this._canvas);

        this._viewId = 0; // TODO: should change depending on in what view the map is

        this._updateStatusCallback = updateStatusCallback;

        this._layerManager = new LayerManager(this._updateStatusCallback, this);
        this._knotManager = new KnotManager(this._updateStatusCallback);

        if(this._knotVisibilityMonitor){
            clearInterval(this._knotVisibilityMonitor);
        }

        // inits the mouse events
        this.initMouseEvents();
        // bind the window events
        this.initWindowEvents();
        // inits the keyboard events
        this.initKeyboardEvents();

        this.monitorKnotVisibility();

        await this.initCamera(this._grammarInterpreter.getCamera(this._viewId));

        // resizes the canvas
        this.resize();

        await this.initLayers();

        this.initKnots();

        let knotsGroups: any = {};

        for(const knot of this._knotManager.knots){

            let knotSpecification = knot.knotSpecification;

            if(knotSpecification.group != undefined){
                if(!(knotSpecification.group.group_name in knotsGroups)){
                    knotsGroups[knotSpecification.group.group_name] = [{
                        id: knot.id,
                        position: knotSpecification.group.position
                    }];
                }else{
                    knotsGroups[knotSpecification.group.group_name].push({
                        id: knot.id,
                        position: knotSpecification.group.position
                    });
                }
            }else{
                knotsGroups[knot.id] = [knot.id]; // group of single knot
            }

        }

        for(const group of Object.keys(knotsGroups)){
            if(knotsGroups[group].length > 1){
                knotsGroups[group].sort((a: any,b: any) => {a.position - b.position});
                let ids = [];
                for(const element of knotsGroups[group]){
                    ids.push(element.id);
                }
                knotsGroups[group] = ids;
            }
        }

        this._updateStatusCallback("layersIds", knotsGroups);

        this.initGrammarManager(this._grammarInterpreter.getProcessedGrammar());

        if(this._grammarInterpreter.getFilterKnots(this._viewId) != undefined){
            this._layerManager.filterBbox = this._grammarInterpreter.getFilterKnots(this._viewId);
        }else{
            this._layerManager.filterBbox = [];
        }
    
        this.render();
    }

    parsePlotsKnotData(){

        let plotsKnots: string[] = [];

        for(const plotAttributes of this._grammarInterpreter.getPlots(this._viewId)){
            for(const knotId of plotAttributes.knots){
                if(!plotsKnots.includes(knotId)){
                    plotsKnots.push(knotId);
                }
            }
        }

        let plotsKnotData: {knotId: string, elements: {coordinates: number[], abstract: number, highlighted: boolean, index: number}[]}[] = [];

        for(const knotId of plotsKnots){
            for(const knot of this._grammarInterpreter.getKnots(this._viewId)){
                if(knotId == knot.id){

                    let lastLink = this._grammarInterpreter.getKnotLastLink(knot, this._viewId);

                    let left_layer = this._layerManager.searchByLayerId(this._grammarInterpreter.getKnotOutputLayer(knot, this._viewId));

                    // let left_layer = this._layerManager.searchByLayerId(lastLink.out.name);

                    if(left_layer == null){
                        throw Error("Layer not found while processing knot");
                    }

                    let elements = [];

                    if(lastLink.out.level == undefined){ // this is a pure knot
                        continue;
                    }

                    let coordinates = left_layer.getCoordsByLevel(lastLink.out.level);

                    let functionValues = left_layer.getFunctionByLevel(lastLink.out.level, knotId);

                    let knotStructure = this._knotManager.getKnotById(knotId);

                    let highlighted = left_layer.getHighlightsByLevel(lastLink.out.level, (<Knot>knotStructure).shaders);

                    let readCoords = 0;

                    let filtered = left_layer.mesh.filtered;

                    for(let i = 0; i < coordinates.length; i++){

                        // if(elements.length >= 1000){ // preventing plot from having too many elements TODO: let the user know that plot is cropped
                        //     break;
                        // }

                        if(filtered.length == 0 || filtered[readCoords] == 1){
                            elements.push({
                                coordinates: coordinates[i],
                                abstract: functionValues[i][0],
                                highlighted: highlighted[i],
                                index: i
                            });
                        }

                        readCoords += coordinates[i].length/left_layer.mesh.dimension;
                    }

                    let knotData = {
                        knotId: knotId,
                        elements: elements
                    }

                    plotsKnotData.push(knotData);
                }
            }
        }   

        return plotsKnotData;
    }

    updateGrammarPlotsData(){

        let plotsKnotData = this.parsePlotsKnotData();

        this._grammarManager.updateGrammarPlotsData(plotsKnotData);

    }

    // if clear == true, elementIndex and level are ignored and all selections are deactivated
    updateGrammarPlotsHighlight(layerId: string, level: LevelType | null, elementIndex: number | null, clear: boolean = false){

        if(!clear){
            let elements: any = {};
        
            for(const knot of this._grammarInterpreter.getKnots(this._viewId)){
                let lastLink = this._grammarInterpreter.getKnotLastLink(knot, this._viewId);
    
                if(lastLink.out.name == layerId && lastLink.out.level == level){
                    elements[knot.id] = elementIndex;
                }
            }
            
            this.grammarManager.setHighlightElementsLocally(elements, true, true);
        }else{
            let knotsToClear: string[] = [];

            for(const knot of this._grammarInterpreter.getKnots(this._viewId)){
                let lastLink = this._grammarInterpreter.getKnotLastLink(knot, this._viewId);
    
                if(lastLink.out.name == layerId){
                    knotsToClear.push(knot.id);
                }
            }

            this.grammarManager.clearHighlightsLocally(knotsToClear);
        }

    }

    initGrammarManager(grammar: IGrammar){
        this._grammarManager = new GrammarManager(grammar, this._updateStatusCallback, this.parsePlotsKnotData(), {"function": this.setHighlightElement, "arg": this});
    }

    //TODO: not sure if mapview should contain this logic
    setHighlightElement(knotId: string, elementIndex: number, value: boolean, _this: any){

        let knot = _this._grammarInterpreter.getKnotById(knotId, this._viewId);

        if(knot == undefined){
            throw Error("Cannot highlight element knot not found");
        }

        let layerId = _this._grammarInterpreter.getKnotOutputLayer(knot, _this._viewId);

        let lastLink = _this._grammarInterpreter.getKnotLastLink(knot, _this._viewId);

        if(lastLink.out.level == undefined)
            return;

        let knotObject = _this.knotManager.getKnotById(knotId);

        let shaders = knotObject.shaders;

        // not sure if layer should be accessed directly or knot.ts be used
        for(const layer of _this._layerManager.layers){
            if(layer.id == layerId){
                layer.setHighlightElements([elementIndex], <LevelType>lastLink.out.level, value, shaders);
                break;
            }
        }

        _this.render();

    }

    toggleKnot(id:string, value: boolean | null = null){
        this._knotManager.toggleKnot(id, value);
        this.render();
    }

    /**
     * Camera initialization function
     * @param {string | ICameraData} data Object containing the camera. If data is a string, then it loads data from disk.
     */
    async initCamera(camera: ICameraData | string): Promise<void> {
        // load the index file and its layers
        const params = typeof camera === 'string' ? await DataApi.getCameraParameters(camera) : camera;

        // sets the camera
        this._camera = CameraFactory.getInstance();
        this._camera.resetCamera(params.position, params.direction.up, params.direction.lookAt, params.direction.right, this._updateStatusCallback);
    }

    async initLayers(): Promise<void> {

        let layers: string[] = [];
        let joinedList: boolean[] = [];
        let centroid = this.camera.getWorldOrigin();

        for(const knot of this._grammarInterpreter.getKnots(this._viewId)){
            if(!knot.knot_op){
                // load layers from knots if they dont already exist
                for(let i = 0; i < knot.integration_scheme.length; i++){

                    let joined = false // if the layers was joined with another layer

                    if(knot.integration_scheme[i].in != undefined && knot.integration_scheme[i].in.name != knot.integration_scheme[i].out){
                        joined = true;
                    }

                    if(!layers.includes(knot.integration_scheme[i].out.name)){
                        layers.push(knot.integration_scheme[i].out.name);
                        joinedList.push(joined);
                    }else if(joined){
                        joinedList[layers.indexOf(knot.integration_scheme[i].out.name)] = joined;
                    }
                }
            }
        }

        for (let i = 0; i < layers.length; i++) {

            let element = layers[i];

            // loads from file if not provided
            const layer = await DataApi.getLayer(element);

            // adds the new layer
            await this.addLayer(layer, centroid, joinedList[i]);

            console.log("received layer -> ", layer);
            
        }

        // const shadow_buildings = await DataApi.getLayer("shadow0_buildings")
        console.log("JOINED LIST = ", joinedList);
        

    }

    /**
     * Add layer geometry and function
     */
    async addLayer(layerData: ILayerData, centroid: number[] | Float32Array, joined: boolean): Promise<void> {

        // gets the layer data if available
        const features = 'data' in layerData ? layerData.data : undefined;

        if (!features) { return; }

        // loads the layers data
        const layer = this._layerManager.createLayer(layerData, centroid, features);

        // not able to create the layer
        if (!layer) { return; }

        if(joined){
            let joinedJson = await DataApi.getJoinedJson(layer.id);
            if(joinedJson)
                layer.setJoinedJson(joinedJson);
        }

        // render
        this.render();
    }

    initKnots(){

        let knotsMap = this._grammarInterpreter.getMap(this._viewId).knots;

        for(const knotGrammar of this._grammarInterpreter.getKnots(this._viewId)){
            let layerId = this._grammarInterpreter.getKnotOutputLayer(knotGrammar, this._viewId);
            
            let layer = this._layerManager.searchByLayerId(layerId);

            let knot = this._knotManager.createKnot(knotGrammar.id, <Layer>layer, knotGrammar, this._grammarInterpreter, this._viewId, knotsMap.includes(knotGrammar.id), this);
            knot.processThematicData(this._layerManager); // send thematic data to the mesh of the physical layer TODO: put this inside the constructor of Knot
            knot.loadShaders(this._glContext); // instantiate the shaders inside the knot TODO: put this inside the constructor of Knot
        }
    }

    /**
     * Inits the mouse events
     */
    initMouseEvents(): void {
        // creates the mouse events manager
        this._mouse = MouseEventsFactory.getInstance();
        this._mouse.setMap(this);

        // binds the mouse events
        this._mouse.bindEvents();
    }

    /**
     * Inits the mouse events
     */
    initKeyboardEvents(): void {
        // creates the mouse events manager
        this._keyboard = KeyEventsFactory.getInstance();
        this._keyboard.setMap(this);
    }

    /**
     * inits the window events
     */
    initWindowEvents(): void {
        // resize listener
        window.addEventListener('resize', () => {
            // resizes the canvas
            this.resize();
            this.render();
        });
    }

    public setCamera(camera: {position: number[], direction: {right: number[], lookAt: number[], up: number[]}}): void{
        this._camera.setPosition(camera.position[0], camera.position[1]);
        this.render();
    }   

    /**
     * Renders the map
     */
    render(): void {
        // no camera defined
        if (!this._camera) { return; }

        // sky definition
        const sky = MapStyle.getColor('sky').concat([1.0]);
        this._glContext.clearColor(sky[0], sky[1], sky[2], sky[3]);

        // tslint:disable-next-line:no-bitwise
        this._glContext.clear(this._glContext.COLOR_BUFFER_BIT | this._glContext.DEPTH_BUFFER_BIT);

        this._glContext.clearStencil(0);
        this._glContext.clear(this._glContext.STENCIL_BUFFER_BIT);

        // updates the camera
        this._camera.update();

        this._camera.loadPosition(JSON.stringify(this.camera));

        // // render the layers
        // for (const layer of this._layerManager.layers) {
        //     // skips based on visibility
        //     if (!layer.visible) { continue; }

        //     if(this._grammarInterpreter.evaluateLayerVisibility(layer.id, this._viewId)){
        //         // sends the camera
        //         layer.camera = this.camera;
        //         // render
        //         // layer.render(this._glContext);
        //     }
        // }

        for(const knot of this._knotManager.knots){
            if(this._grammarInterpreter.evaluateKnotVisibility(knot, this._viewId)){
                if(!knot.visible)
                    this._knotManager.toggleKnot(knot.id, true);
                knot.render(this._glContext, this.camera);
            }else{
                if(knot.visible)
                    this._knotManager.toggleKnot(knot.id, false);
            }
        }

    }

    private monitorKnotVisibility(){
        let previousKnotVisibility: boolean[] = [];

        for(const knot of this._knotManager.knots){
            previousKnotVisibility.push(knot.visible);
        }

        let _this = this;

        this._knotVisibilityMonitor = window.setInterval(function(){
            for(let i = 0; i < _this._knotManager.knots.length; i++){
                let currentVisibility = _this._grammarInterpreter.evaluateKnotVisibility(_this._knotManager.knots[i], _this._viewId);

                // if visibility of some knot changed need to rerender the map
                if(previousKnotVisibility[i] != currentVisibility){
                    previousKnotVisibility[i] = currentVisibility;
                    _this.render();
                }

            }
        }, 100);
    }

    /**
     * Resizes the html canvas
     */
    resize(): void {

        const targetWidth = this._mapDiv.clientWidth;
        const targetHeight = this._mapDiv.clientHeight;

        const value = Math.max(targetWidth, targetHeight);
        this._glContext.viewport(0, 0, value, value);
        this._canvas.width = targetWidth;
        this._canvas.height = targetHeight;

        // stores in the camera
        this._camera.setViewportResolution(targetWidth, targetHeight);

        for (const knot of this._knotManager.knots){
            if (!knot.visible) { continue; }

            for(const shader of knot.shaders){
                if(shader instanceof ShaderPicking){
                    shader.resizeDirty = true;
                }

                if(shader instanceof ShaderPickingTriangles){
                    shader.resizeDirty = true;
                }
            }
        }

    }
}

export var MapViewFactory = (function(){

    var instance: MapView;
  
    return {
      getInstance: function(mapDiv: HTMLElement, grammarInterpreter: any){
          if (instance == null) {
              instance = new MapView();
          }
          instance.resetMap(mapDiv, grammarInterpreter);
          return instance;
      }
    };
  
})();