<script lang="ts" setup>
  import {ref} from 'vue'
  const name = ref('John Doe');
  const status = ref('pending');
  const tasks = ref(['Task 1', 'Task 2', 'Task 3', 'Task 4']);
  const link = ref('https://google.com')
  const newTask = ref('');
  const toggleTask = () => {
    if(status.value === 'active') {
      status.value = 'pending'
    } else if(status.value === 'pending') {
      status.value = 'inactive'
    } else {
      status.value = 'active'
    }
  }

  const addTask = () => {
    tasks.value.push(newTask.value)
    newTask.value = ''
  }

  const deleteTask = (index: number) => {
    tasks.value.splice(index, 1)
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
    <li v-for="(task, index) in tasks" :key="task" class="flex gap-2">
      <span>{{task}}</span>
      <button @click="deleteTask(index)" class="text-red-900 cursor-pointer">x</button>
    </li>
  </ul>
  <a :href="link">Google</a>
  <br>
  <button @click="toggleTask" class="text-amber-300">Toggle status</button>
  <p>{{status}}</p>

  <form @submit.prevent="addTask">
    <label for="newTask">Add task</label>
    <br>
    <input type="text" id="newTask" placeholder="Enter new task" v-model="newTask"/>
  </form>
</template>
