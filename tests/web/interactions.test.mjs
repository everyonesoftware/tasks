import test from 'node:test';
import assert from 'node:assert/strict';
import {occurrenceActions, createCompletedDisclosure} from '../../apps/web/interactions.mjs';
const row={occurrenceId:'one',taskId:'task',completed:false,dueDate:'2026-11-18'};
const state={date:'2026-11-18',today:[row],upcoming:[{...row,occurrenceId:'future',dueDate:'2026-11-19'}]};
test('popup actions revalidate the latest occurrence and current date',()=>{
  const actions=(s,id='one',connected=true,pending=false,date=state.date)=>occurrenceActions(s,id,connected,pending,date);
  assert.deepEqual(actions(state),{makeCurrent:true,complete:true,undo:false});
  assert.deepEqual(actions({...state,today:[{...row,completed:true}]}),{makeCurrent:false,complete:false,undo:true});
  for(const result of [actions(state,'future'),actions(state,'removed'),actions(state,'one',false),actions(state,'one',true,true),actions(state,'one',true,false,'2026-11-19'),actions(null)]) assert.deepEqual(result,{makeCurrent:false,complete:false,undo:false});
});
test('completed disclosure retains explicit choice without a rendered list and resets for date or account',()=>{
  const disclosure=createCompletedDisclosure();
  assert.equal(disclosure.read('2026-11-18'),false);
  assert.equal(disclosure.read('2026-11-18',true),true);
  assert.equal(disclosure.read('2026-11-18'),true);
  assert.equal(disclosure.read('2026-11-19',true),false,'old DOM must not transfer yesterday’s expansion');
  assert.equal(disclosure.read('2026-11-19',true),true);
  assert.equal(disclosure.read('2026-11-19',false),false);
  assert.equal(disclosure.read('2026-11-19'),false);
  disclosure.read('2026-11-19',true);disclosure.reset();
  assert.equal(disclosure.read('2026-11-19'),false);
});
