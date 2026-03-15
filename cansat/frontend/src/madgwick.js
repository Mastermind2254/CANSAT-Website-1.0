/**
 * Madgwick AHRS — 6-DOF variant (no magnetometer)
 * Fuses accelerometer + gyroscope to produce quaternion orientation.
 * Suitable for MPU-6050 (no mag).
 *
 * Usage:
 *   const filter = new MadgwickAHRS(0.1)   // beta = filter gain
 *   filter.update(gx,gy,gz,ax,ay,az, dt)   // dt in seconds
 *   const [roll,pitch,yaw] = filter.getEulerDeg()
 */
export class MadgwickAHRS {
  constructor(beta = 0.1) {
    this.beta = beta
    // Quaternion [w, x, y, z]
    this.q = [1, 0, 0, 0]
  }

  update(gx, gy, gz, ax, ay, az, dt) {
    let [q0, q1, q2, q3] = this.q

    // Normalise accelerometer
    let norm = Math.sqrt(ax*ax + ay*ay + az*az)
    if (norm === 0) return
    ax /= norm; ay /= norm; az /= norm

    // Gradient descent correction
    const _2q0 = 2*q0, _2q1 = 2*q1, _2q2 = 2*q2, _2q3 = 2*q3
    const _4q0 = 4*q0, _4q1 = 4*q1, _4q2 = 4*q2
    const _8q1 = 8*q1, _8q2 = 8*q2
    const q0q0 = q0*q0, q1q1 = q1*q1, q2q2 = q2*q2, q3q3 = q3*q3

    const s0 = _4q0*q2q2 + _2q2*ax + _4q0*q1q1 - _2q1*ay
    const s1 = _4q1*q3q3 - _2q3*ax + 4*q0q0*q1 - _2q0*ay - _4q1 + _8q1*q1q1 + _8q1*q2q2 + _4q1*az
    const s2 = 4*q0q0*q2 + _2q0*ax + _4q2*q3q3 - _2q3*ay - _4q2 + _8q2*q1q1 + _8q2*q2q2 + _4q2*az
    const s3 = 4*q1q1*q3 - _2q1*ax + 4*q2q2*q3 - _2q2*ay

    norm = Math.sqrt(s0*s0 + s1*s1 + s2*s2 + s3*s3)
    if (norm === 0) return
    const sn0 = s0/norm, sn1 = s1/norm, sn2 = s2/norm, sn3 = s3/norm

    // Gyro rate in rad/s
    const qDot0 = 0.5*(-q1*gx - q2*gy - q3*gz) - this.beta*sn0
    const qDot1 = 0.5*(q0*gx + q2*gz - q3*gy)  - this.beta*sn1
    const qDot2 = 0.5*(q0*gy - q1*gz + q3*gx)  - this.beta*sn2
    const qDot3 = 0.5*(q0*gz + q1*gy - q2*gx)  - this.beta*sn3

    q0 += qDot0 * dt; q1 += qDot1 * dt
    q2 += qDot2 * dt; q3 += qDot3 * dt

    norm = Math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3)
    this.q = [q0/norm, q1/norm, q2/norm, q3/norm]
  }

  /** Returns [roll, pitch, yaw] in degrees. Yaw drifts — no mag. */
  getEulerDeg() {
    const [q0, q1, q2, q3] = this.q
    const roll  = Math.atan2(2*(q0*q1 + q2*q3), 1 - 2*(q1*q1 + q2*q2))
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2*(q0*q2 - q3*q1))))
    const yaw   = Math.atan2(2*(q0*q3 + q1*q2), 1 - 2*(q2*q2 + q3*q3))
    const toDeg = 180 / Math.PI
    return [roll*toDeg, pitch*toDeg, yaw*toDeg]
  }

  getQuaternion() { return [...this.q] }

  reset() { this.q = [1, 0, 0, 0] }
}
