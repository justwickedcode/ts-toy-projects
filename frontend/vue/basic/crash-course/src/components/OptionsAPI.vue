<script lang="ts">
export default {
  data() {
    return {
      name: 'Johnny Doe',
      status: 'pending',
      tasks: ['Task 1', 'Task 2', 'Task 3', 'Task 4'],
      link: 'https://google.com'
    }
  },
  methods: {
    toggleTask() {
      if(this.status === 'active') {
        this.status = 'pending'
      } else if(this.status === 'pending') {
        this.status = 'inactive'
      } else {
        this.status = 'active'
      }
    }
  }
}
</script>

<template>
  <h1 v-if="name && name.length > 0" class="text-blue-600">
    Hello <span class="text-green-600">{{name}}!</span>
  </h1>
  <h1 v-else>
    Hello World!
  </h1>
  <br>

  <h3>Tasks</h3>
  <ul>
    <li v-for="task in tasks" :key="task">{{task}}</li>
  </ul>
  <a :href="link">Google</a>
  <br>
  <button @click="toggleTask" class="text-amber-300">Toggle status</button>
  <p>{{status}}</p>
</template>
