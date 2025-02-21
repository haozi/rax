/**
 * Base Component class definition.
 */
import Host from './host';
import { updateChildProps, removeComponentProps } from './updater';
import { enqueueRender } from './enqueueRender';
import isFunction from './isFunction';
import {
  RENDER,
  ON_SHOW,
  ON_HIDE,
  COMPONENT_DID_MOUNT,
  COMPONENT_DID_UPDATE,
  COMPONENT_WILL_MOUNT,
  COMPONENT_WILL_UNMOUNT,
  COMPONENT_WILL_RECEIVE_PROPS, COMPONENT_WILL_UPDATE,
} from './cycles';

export default class Component {
  constructor() {
    this.state = {};
    this.props = {};

    this.__shouldUpdate = false;
    this._methods = {};
    this._hooks = {};
    this.hooks = []; // ??
    this._hookID = 0;

    this._pendingStates = [];
    this._pendingCallbacks = [];
  }

  // Bind to this instance.
  setState = (partialState, callback) => {
    if (partialState != null) {
      this._pendingStates.push(partialState);
    }

    if (isFunction(callback)) {
      this._pendingCallbacks.push(callback);
    }

    enqueueRender(this);
  }

  forceUpdate = (callback) => {
    if (isFunction(callback)) {
      this._pendingCallbacks.push(callback);
    }
    this._updateComponent();
  }

  getHooks() {
    return this._hooks;
  }

  getHookID() {
    return ++this._hookID;
  }

  _cycles = {};

  /**
   * Register a lifecycle function.
   */
  _registerLifeCycle(cycle, fn) {
    const currentCycles = this._cycles[cycle] = this._cycles[cycle] || [];
    currentCycles.push(fn);
  }

  /**
   * Used in render cycle
   * @private
   */
  _updateData(data) {
    if (!this._internal) return;
    data.$ready = true;
    this.__updating = true;
    Object.assign(this.state, data);
    this._internal.setData(data, () => {
      this.__updating = false;
    });
  }

  _updateMethods(methods) {
    Object.assign(this._methods, methods);
  }

  _updateChildProps(instanceId, props) {
    updateChildProps(this, instanceId, props);
  }

  _collectState() {
    const state = Object.assign({}, this.state);
    let parialState;
    while (parialState = this._pendingStates.shift()) { // eslint-disable-line
      if (parialState == null) continue; // eslint-disable-line
      if (isFunction(parialState)) {
        Object.assign(state, parialState.call(this, state, this.props));
      } else {
        Object.assign(state, parialState);
      }
    }
    return state;
  }

  _mountComponent() {
    // Step 1: get state from getDerivedStateFromProps,
    // __getDerivedStateFromProps is a reference to constructor.getDerivedStateFromProps
    if (this.__getDerivedStateFromProps) {
      const getDerivedStateFromProps = this.__getDerivedStateFromProps;
      const partialState = getDerivedStateFromProps(this.props, this.state);
      if (partialState) this.state = Object.assign({}, partialState);
    }

    // Step 2: trigger will mount.
    this._trigger(COMPONENT_WILL_MOUNT);

    // Step3: trigger render.
    this._trigger(RENDER);

    // Step4: mark __mounted = true
    if (!this.__mounted) {
      this.__mounted = true;

      // Step5: trigger did mount
      this._trigger(COMPONENT_DID_MOUNT);
    }

    // Step6: create prevProps and prevState reference
    this.prevProps = this.props;
    this.prevState = this.state;
  }

  _updateComponent() {
    if (!this.__mounted) return;

    // Step1: propTypes check, now skipped.
    // Step2: make props to prevProps, and trigger willReceiveProps
    const nextProps = this.props; // actually this is nextProps
    const prevProps = this.props = this.prevProps || this.props;
    if (this.__mounted && diffProps(prevProps, nextProps)) {
      this._trigger(COMPONENT_WILL_RECEIVE_PROPS, this.props);
    }

    // Step3: collect pending state
    let nextState = this._collectState();
    const prevState = this.prevState || this.state;

    // Step4: update state if defined getDerivedStateFromProps
    let stateFromProps;
    if (this.__getDerivedStateFromProps) {
      const getDerivedStateFromProps = this.__getDerivedStateFromProps;
      const partialState = getDerivedStateFromProps(nextProps, nextState);
      if (partialState) stateFromProps = Object.assign({}, partialState);
    }
    // if null, means not to update state.
    if (stateFromProps !== undefined) nextState = stateFromProps;

    // Step5: judge shouldComponentUpdate
    if (this.__mounted) {
      this.__shouldUpdate = true;
      if (
        !this.__forceUpdate
        && this.shouldComponentUpdate
        && this.shouldComponentUpdate(nextProps, nextState) === false
      ) {
        this.__shouldUpdate = false;
      } else {
        // Step6: trigger will update
        this._trigger(COMPONENT_WILL_UPDATE, nextProps, nextState);
      }
    }

    this.props = nextProps;
    this.state = nextState;
    this.__forceUpdate = false;

    // Step8: trigger render
    if (this.__shouldUpdate) {
      this._trigger(RENDER);
      this._trigger(COMPONENT_DID_UPDATE, prevProps, prevState);
    }

    this.prevProps = this.props;
    this.prevState = this.state;
  }

  _unmountComponent() {
    this._trigger(COMPONENT_WILL_UNMOUNT);
    // Clean up hooks
    this.hooks.forEach(hook => {
      if (isFunction(hook.destory)) hook.destory();
    });
    this._internal.instance = null;
    this._internal = null;
    this.__mounted = false;
    removeComponentProps(this.props.__tagId);
  }

  /**
   * Trigger lifecycle with args.
   * @param cycle {String} Name of lifecycle.
   * @param args
   * @private
   */
  _trigger(cycle, ...args) {
    switch (cycle) {
      case COMPONENT_WILL_MOUNT:
      case COMPONENT_DID_MOUNT:
      case COMPONENT_WILL_RECEIVE_PROPS:
      case COMPONENT_WILL_UPDATE:
      case COMPONENT_DID_UPDATE:
      case COMPONENT_WILL_UNMOUNT:
      case ON_SHOW:
      case ON_HIDE:
        if (isFunction(this[cycle])) this[cycle](...args);
        if (this._cycles.hasOwnProperty(cycle)) {
          this._cycles[cycle].forEach(fn => fn(...args));
        }
        break;

      case RENDER:
        if (!isFunction(this.render)) throw new Error('It seems component have no render method.');
        Host.current = this;
        this._hookID = 0;
        const nextProps = args[0] || this.props;
        const nextState = args[1] || this.state;

        this.render(this.props = nextProps, this.state = nextState);
        break;
    }
  }

  /**
   * Internal means page/component instance of miniapp.
   * @param internal
   * @private
   */
  _setInternal(internal) {
    this._internal = internal;
    this.props = internal.props;
    if (!this.state) this.state = {};
    Object.assign(this.state, internal.data);
  }
}

function diffProps(prev, next) {
  for (let key in next) {
    if (next[key] !== prev[key]) return true;
  }
  return false;
}
