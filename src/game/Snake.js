import _ from 'lodash'

import config from '../config.json'
import { pool } from '../genetics/PoolClient'
import {
  collidePointRect,
  distNotSquared,
  collidePointCircle,
  getRandomPosition,
  HIT_BORDERS
} from '../util'
import workerPool from '../workerPool'

class Snake {
  constructor(
    snakesList,
    id,
    canvasWidth,
    canvasHeight,
    foodPool,
    debug = false
  ) {
    this.id = id
    this.snakesList = snakesList
    this.canvasWidth = canvasWidth
    this.canvasHeight = canvasHeight
    this.color = config.Snake.Color
    this.history = []
    this.speed = config.SnakeSpeed //maxspeed
    this.size = config.SnakeSize
    this.angle = TWO_PI * Math.random() //
    this.maxAngle = TWO_PI / 9
    this.stepAngle = this.maxAngle / 20
    this.direction = 2 // LEFT RIGHT STILL
    this.whiskersize = config.WhiskerSize
    this.pos = getRandomPosition(this.canvasWidth, this.canvasHeight)
    this.lastInputLayer = _.fill(new Array(config.InputSize), 0) // Keeping it for debugging
    this.lastEvaluation = null // Same
    this.diedOn = 0
    this.debug = debug
    this.foodPool = foodPool
    this.currentDirectionUpdateTicks = 0
    this.directionUpdatePeriod = config.SnakeDirectionUpdatePeriod
    this.resultToMatch = 0
  }

  getInputLayerAsync() {
    return new Promise((resolve, reject) => {
      const whiskerSize = this.whiskersize

      const snakesList = this.snakesList.map(snake => ({
        history: snake.history.map(item => ({ x: item.x, y: item.y })),
        pos: { x: snake.pos.x, y: snake.pos.y }
      }))
      const id = this.id
      const size = this.size
      const food = this.foodPool.food.map(food => ({ x: food.x, y: food.y }))
      const foodSize = this.foodPool.foodSize

      const displayedWhiskers = config.NbWhiskers

      const inputLayerArgs = {
        displayedWhiskers,
        x: this.pos.x,
        y: this.pos.y,
        whiskerSize,
        snakesList,
        id,
        size,
        food,
        foodSize,
        borders: HIT_BORDERS,
        baseAngle: this.angle
      }
      workerPool
        .send(inputLayerArgs)
        .on('done', response => {
          resolve(response)
        })
        .on('error', error => {
          console.error('Worker errored:', error)
          resolve(error)
        })
    })
  }

  drawWhisker(x, y, x1, y1, isFood, hit) {
    fill(360, 100, 100)
    noStroke()
    ellipse(x1, y1, 4)

    if (hit) {
      stroke(200, 100, 100)

      if (isFood) {
        stroke(80, 100, 100)
      }
    } else {
      stroke(40, 100, 100)
    }

    line(x, y, x1, y1)
  }

  update() {
    this.getInputsAndAssignDir()
    this.store()
    this.move()
    this.eat()
    this.checkCollisions()
  }

  matchResult() {
    pool.matchResult(this.id, this.resultToMatch)
    this.resultToMatch = 0
  }

  getInputsAndAssignDir = () => {
    if (++this.currentDirectionUpdateTicks >= this.directionUpdatePeriod) {
      this.currentDirectionUpdateTicks = 0
      this.getInputLayerAsync().then(inputs => {
        this.lastInputLayer = inputs

        pool.evaluateGenome(this.lastInputLayer, this.id).then(outputs => {
          if (outputs.length) {
            this.setPressedKey(outputs[0])
          }
        })
      })
    }
  }

  // Outputs is an array with 3 elements [a,b,c]
  // We arbitrarily decided which is going to do what
  // I could have decided a was stay-still, b was left
  setPressedKey = value => {
    let newDirection = 2
    if (value > 0.55) newDirection = 1
    if (value < 0.45) newDirection = 0

    if (newDirection === this.direction) {
      this.resultToMatch += config.SameDirectionReward
    }

    this.direction = newDirection
  }

  // Adds the snake position to its history if far enough from last one
  store() {
    let farEnough = false
    const lastHistory =
      this.history.length && this.history[this.history.length - 1]

    if (!!lastHistory) {
      farEnough =
        distNotSquared(lastHistory.x, lastHistory.y, this.pos.x, this.pos.y) >
        this.size * this.size + 1
    } else {
      farEnough = true
    }

    if (farEnough) {
      var currentPos = this.pos.copy()

      if (this.history.length) {
        this.history[this.history.length - 1].head = false
      }

      currentPos.head = true
      currentPos.id = this.id

      this.history.push(currentPos)

      if (this.history.length >= config.SnakeMaxLength) {
        this.history.shift()
      }
    }
  }

  // Did we collide?
  checkCollisions() {
    const snakesList = this.snakesList
    if (this.history.length < 1) return false
    let potentialColliders = this.history.slice(0, -1)

    //Adding current pos and history
    potentialColliders.push([this.pos.x, this.pos.y])
    const ownHistoryIndex = potentialColliders.length
    const others = snakesList.filter(c => c.id != this.id)

    others.forEach(o => {
      potentialColliders = potentialColliders.concat(o.history)
    })

    const target = this.history[this.history.length - 1]

    const isColliding = potentialColliders.some((pos, i) => {
      const d = distNotSquared(pos.x, pos.y, target.x, target.y)
      const colliding = d < this.size * this.size
      if (colliding) {
        if (i > ownHistoryIndex) {
          this.diedOn = 1 // He died on enemy
        }
        this.stop()
      }
      return colliding
    })

    // const collidesWithRect = collidePointRect(
    //   this.pos.x,
    //   this.pos.y,
    //   (this.canvasWidth - config.CenterEllipseWidth) / 2,
    //   (this.canvasHeight - config.CenterEllipseHeight) / 2,
    //   config.CenterEllipseWidth,
    //   config.CenterEllipseHeight
    // )

    const isOutOfBounds =
      this.pos.x > this.canvasWidth ||
      this.pos.x < 0 ||
      this.pos.y > this.canvasHeight ||
      this.pos.y < 0
    if (isOutOfBounds) {
      this.stop()
    }
    return isColliding || isOutOfBounds
  }

  stop() {
    const history = this.history.slice()
    setTimeout(() => {
      history.forEach(pos => {
        fill(
          config.Game.ClearBackground.h,
          config.Game.ClearBackground.s,
          config.Game.ClearBackground.b
        )
        ellipse(pos.x, pos.y, this.size * 1.5, this.size * 1.5)
      })
    }, 700)

    this.resetPosition()
    this.resultToMatch += config.DieReward
  }

  resetPosition() {
    this.pos = getRandomPosition(this.canvasWidth, this.canvasHeight)
    this.history.length = 0
  }

  show() {
    this.update()

    if (this.debug) {
      this.showHistory()
    } else {
      this.showTrail()
    }
  }

  showHistory() {
    stroke(this.hue, 90, 70)
    fill(this.hue, 90, 70, 0.3)
    this.history.forEach(pos => ellipse(pos.x, pos.y, this.size, this.size))

    ellipse(this.pos.x, this.pos.y, this.size, this.size)
  }

  showTrail() {
    fill(this.color.h, this.color.s, this.color.b)
    ellipse(this.pos.x, this.pos.y, this.size, this.size)

    if (this.history.length) {
      const lastHistoryPos = this.history[0]
      fill(
        config.Game.ClearBackground.h,
        config.Game.ClearBackground.s,
        config.Game.ClearBackground.b
      )
      ellipse(
        lastHistoryPos.x,
        lastHistoryPos.y,
        this.size * 1.5,
        this.size * 1.5
      )
    }
  }

  move = () => {
    if (this.direction !== 2) {
      this.angle += (this.direction === 1 ? 1 : -1) * this.stepAngle
    }
    this.pos.x += this.speed * Math.cos(this.angle)
    this.pos.y += this.speed * Math.sin(this.angle)
  }

  eat() {
    this.foodPool.food.forEach((piece, index) => {
      const eatsFood = collidePointCircle(
        this.pos.x,
        this.pos.y,
        piece.x,
        piece.y,
        this.foodPool.foodSize
      )
      if (eatsFood) {
        this.foodPool.eat(index)
        this.resultToMatch += config.EatFoodReward
      }
    })
  }
}

export default Snake
