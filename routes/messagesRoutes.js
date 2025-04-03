import express from 'express';
import {
  createMessage,
  getAllMessages,
  deleteMessage,
  replyToMessage
} from '../controller/messagesController.js';

const router = express.Router();

// Xabarlar uchun routelar
router.post('/', createMessage);
router.get('/', getAllMessages);
router.delete('/:id', deleteMessage);
router.post('/reply', replyToMessage); // Reply route

export default router;