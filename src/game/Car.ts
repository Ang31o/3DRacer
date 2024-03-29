import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Engine } from '../engine/Engine';
import { GameEntity } from '../engine/GameEntity';
import { Exhaust } from './exhaust/Exhaust';
import eventService from '../engine/utilities/eventService';
import { Events } from '../events';
import { CarLight } from './CarLight';

export class Car extends THREE.EventDispatcher implements GameEntity {
  public instance!: THREE.Object3D;
  public body!: CANNON.Body;
  private vehicle!: CANNON.RaycastVehicle;
  private wheels!: THREE.Object3D<THREE.Object3DEventMap>[];
  private exhaust!: Exhaust;
  private maxSteerVal: number = 1; // How sharp it steers
  private maxForceForward: number = 1000; // How fast it goes
  private maxForceBack: number = 500; // How fast it goes
  private brakeForce: number = 5; // How fast it breaks
  private movementKeys = [
    'w',
    'a',
    's',
    'd',
    ' ',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ];
  private pressedKeys: string[] = [];

  constructor(private engine: Engine) {
    super();
    this.initObject3D();
    this.initPhysics();
    this.addKeyboardControls();
  }

  initObject3D(): void {
    this.instance = this.engine.resources.getItem('Car').scene;
    // Make car parts cast a shadow
    this.instance.traverse((child) => {
      if (child.type === 'Mesh') child.castShadow = true;
    });
    // Move wheels to a separate objects so they can be updated with world transform on "postStep" event
    this.wheels = this.instance.children
      .filter((child) => child.name.includes('wheel'))
      .sort((a, b) => parseInt(a.name) - parseInt(b.name));
    this.instance.position.set(0, 0.32, 0);
    this.engine.scene.add(this.instance);
    this.engine.scene.add(...this.wheels);
    eventService.emit(Events.SET_CAMERA_FOLLOW, this.instance);
    this.exhaust = new Exhaust(this.engine, this);
    this.addLights();
  }

  addLights(): void {
    const frontLightProps = {
      color: 0xffffff,
      intensity: 1500,
      width: 0.4,
      height: 0.18,
      displayHelper: false,
    };
    const brakeLightProps = {
      color: 0xff0000,
      intensity: 50,
      width: 0.5,
      height: 0.09,
      displayHelper: true,
    };
    new CarLight(this, 'lightBrakeLeft', brakeLightProps, true, Events.BRAKE);
    new CarLight(this, 'lightBrakeRight', brakeLightProps, true, Events.BRAKE);
    const lightFrontLeft = new CarLight(
      this,
      'lightFrontLeft',
      frontLightProps,
      false
    );
    const lightFrontRight = new CarLight(
      this,
      'lightFrontRight',
      frontLightProps,
      false
    );
    const quaternion = new THREE.Quaternion();
    quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    lightFrontLeft.instance.quaternion.copy(quaternion);
    lightFrontRight.instance.quaternion.copy(quaternion);
  }

  initPhysics(): void {
    const carLength = 1.6;
    const carHeight = 0.5;
    const carWidth = 1.2;
    const wheelRadius = 0.3;

    // ADD CAR
    const chassisShape = new CANNON.Box(
      new CANNON.Vec3(carWidth, carHeight, carLength)
    );
    this.body = new CANNON.Body({ mass: 150 });
    this.body.addShape(chassisShape);
    this.body.position.set(0, 4, 0);
    this.engine.physics.instance.addBody(this.body);

    // CREATE VEHICLE
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.body,
      indexForwardAxis: 2,
      indexRightAxis: 0,
      indexUpAxis: 1,
    });

    const wheelOptions = {
      radius: wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0), // Direction of down
      suspensionStiffness: 30, // How soft the suspension is
      suspensionRestLength: 0.7, // Suspension height
      maxSuspensionTravel: 0.3, // maxSuspensionTravel can never be more than suspensionRestLength
      frictionSlip: 1.4,
      dampingRelaxation: 2.3,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      axleLocal: new CANNON.Vec3(1, 0, 0), // Axle on this car goes on the X axis
      chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0), // Dummy value, will be set for each of the wheel we apply
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    // ADDING WHEELS
    wheelOptions.chassisConnectionPointLocal.set(-carWidth, 0, 1.1); // Top right wheel
    this.vehicle.addWheel(wheelOptions);
    wheelOptions.chassisConnectionPointLocal.set(carWidth, 0, 1.1); // Top left wheel
    this.vehicle.addWheel(wheelOptions);
    wheelOptions.chassisConnectionPointLocal.set(-carWidth, 0, -1.2); // Bottom right wheel
    this.vehicle.addWheel(wheelOptions);
    wheelOptions.chassisConnectionPointLocal.set(carWidth, 0, -1.2); // Bottom left wheel
    this.vehicle.addWheel(wheelOptions);

    this.vehicle.addToWorld(this.engine.physics.instance);

    const wheelBodies = [] as CANNON.Body[];
    const wheelMaterial = new CANNON.Material('wheel');
    this.vehicle.wheelInfos.forEach((wheel) => {
      const cylinderShape = new CANNON.Cylinder(
        wheel.radius,
        wheel.radius,
        wheel.radius / 2,
        20
      );
      const wheelBody = new CANNON.Body({
        mass: 1,
        material: wheelMaterial,
        type: CANNON.Body.KINEMATIC,
        collisionFilterGroup: 0, // turn off collisions
      });
      wheelBody.addShape(
        cylinderShape,
        new CANNON.Vec3(),
        new CANNON.Quaternion().setFromEuler(0, 0, Math.PI / 2)
      );
      wheelBodies.push(wheelBody);
      this.engine.physics.instance.addBody(wheelBody);
    });

    // UPDATE WHEELS
    this.engine.physics.instance.addEventListener('postStep', () => {
      this.vehicle.wheelInfos.forEach((wheel, wheelIndex) => {
        this.vehicle.updateWheelTransform(wheelIndex);
        const transform = wheel.worldTransform;
        wheelBodies[wheelIndex].position.copy(transform.position);
        wheelBodies[wheelIndex].quaternion.copy(transform.quaternion);
        this.wheels[wheelIndex]?.position.set(
          transform.position.x,
          transform.position.y,
          transform.position.z
        );
        this.wheels[wheelIndex]?.quaternion.set(
          transform.quaternion.x,
          transform.quaternion.y,
          transform.quaternion.z,
          transform.quaternion.w
        );
      });
    });
  }

  onForward(forceValue: number): void {
    this.vehicle.applyEngineForce(forceValue, 0);
    this.vehicle.applyEngineForce(forceValue, 1);
    eventService.emit(Events.GAS);
  }

  onGearboxReverse(): void {
    this.vehicle.applyEngineForce(this.maxForceBack, 0);
    this.vehicle.applyEngineForce(this.maxForceBack, 1);
    eventService.emit(Events.GAS);
  }

  onSteer(direction: number): void {
    this.vehicle.setSteeringValue(this.maxSteerVal * direction, 0);
    this.vehicle.setSteeringValue(this.maxSteerVal * direction, 1);
  }

  onBreak(brakeForce: number): void {
    eventService.emit(Events.BRAKE, brakeForce !== 0);
    this.vehicle.setBrake(brakeForce, 0);
    this.vehicle.setBrake(brakeForce, 1);
    this.vehicle.setBrake(brakeForce, 2);
    this.vehicle.setBrake(brakeForce, 3);
  }

  updateMovement(): void {
    if (this.pressedKeys.length === 0) return;

    if (this.pressedKeys.indexOf('w') > -1) {
      this.onForward(-this.maxForceForward);
    }
    if (this.pressedKeys.indexOf('s') > -1) {
      this.onGearboxReverse();
    }
    if (this.pressedKeys.indexOf('a') > -1) {
      this.onSteer(1);
      console.log('steer');
    }
    if (this.pressedKeys.indexOf('d') > -1) {
      this.onSteer(-1);
    }
    if (this.pressedKeys.indexOf(' ') > -1) {
      this.onBreak(this.brakeForce);
    }
  }

  updateMovementStop(eventKey: string): void {
    if (eventKey === 'w' || eventKey === 's') {
      this.onForward(0);
    }
    if (eventKey === 'a' || eventKey === 'd') {
      this.onSteer(0);
    }
    if (eventKey === ' ') {
      this.onBreak(0);
    }
  }

  addKeyboardControls(): void {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'r') {
        this.body.quaternion.setFromAxisAngle(
          new CANNON.Vec3(0, 1, 0),
          Math.PI
        );
        return;
      }
      if (
        this.pressedKeys.indexOf(event.key) === -1 &&
        this.movementKeys.indexOf(event.key) > -1
      ) {
        this.pressedKeys.push(event.key);
      }
    });

    document.addEventListener('keyup', (event) => {
      const keyIndex = this.pressedKeys.indexOf(event.key);
      if (keyIndex > -1) {
        this.pressedKeys.splice(keyIndex, 1);
        this.updateMovementStop(event.key);
      }
    });
  }

  update(delta: number): void {
    this.updateMovement();
    this.instance.position.set(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
    );
    this.instance.quaternion.set(
      this.body.quaternion.x,
      this.body.quaternion.y,
      this.body.quaternion.z,
      this.body.quaternion.w
    );
    this.exhaust.update(delta);
  }
}
